import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRODUCT_CATALOG_READER, TAX_RATE_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { TaxRateResolver } from '../../../shared/contracts/tax-rate-resolver.port';
import {
  MercadoLivreApiClient,
  MlCatalogListingSummary,
  MlItemAttribute,
  MlItemPricingContext,
} from '../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../marketplace-intelligence/application/mercado-livre-connection.service';
import {
  DEFAULT_TARGET_MARGIN_PCT,
  INITIAL_STOCK,
  buildCatalogItemPayload,
  extractGtin,
  catalogNameRelatesToTitle,
  solvePriceForMargin,
} from '../domain/ml-catalog-listing-creation';

// Flag PRÓPRIA da criação de anúncios (separada da de campanhas): ligar uma
// não liga a outra. Falha fechada — só o texto exato "true" libera.
export const CATALOG_CREATE_FLAG = 'ML_CATALOG_LISTING_CREATE_ENABLED';
// Piso: a criação nunca aceita margem alvo abaixo disto (o padrão é 40).
const MIN_TARGET_MARGIN_PCT = 5;
// Anúncios por chamada do plano em lote (cada um faz várias chamadas ao ML).
const BATCH_MAX_ITEMS = 5;
// Mesmo critério do detalhe do anúncio (catalog_listing OU catalog_product_id):
// o resumo em lote do ML traz só catalog_listing, e anúncios ligados a uma ficha
// apareciam como "tradicionais" e depois eram barrados como "já é catálogo".
function hasCatalog(s: { isCatalogListing: boolean; catalogProductId: string | null }): boolean {
  return s.isCatalogListing || Boolean(s.catalogProductId);
}

const SUMMARIES_CACHE_TTL_MS = 30 * 60 * 1000;
// Depois do TTL, a lista antiga ainda serve as leituras (plano/lote) enquanto uma
// atualização roda em segundo plano — a leitura completa da conta leva 65–145 s
// (medido em 09/10/2026), mais que o timeout de 90 s do MCP. A criação não usa isso.
const SUMMARIES_STALE_MAX_MS = 12 * 60 * 60 * 1000;
// Sem lista nenhuma (1ª chamada após deploy), espera até aqui e devolve 202
// "carregando" em vez de deixar o cliente estourar o timeout.
const SUMMARIES_WAIT_MS = 45 * 1000;

export interface CatalogCreationOptions {
  targetMarginPct?: number;
  taxRatePct?: number;
  // Anúncio com variações: cada variação tem SKU/EAN próprios e gera o SEU
  // anúncio de catálogo. Obrigatório quando o anúncio tem variações.
  variationId?: string;
}

interface CreationUnit {
  variationId: string | null;
  label: string | null;
  skuCode: string | null;
  attributes: MlItemAttribute[];
  where: string;
  // Só para variação: nomes dos campos recebidos do ML (sem valores).
  diagnostic?: string;
}

export interface VariationPlanRow {
  variationId: string;
  skuCode: string | null;
  label: string | null;
  plan: CatalogCreationPlan | null;
  // Motivo quando não dá para criar (sem EAN, sem ficha, sem custo...).
  error: string | null;
}

export type BatchRowStatus = 'READY' | 'ALREADY_HAS_CATALOG' | 'BLOCKED';

export interface BatchPlanRow {
  itemId: string;
  variationId: string | null;
  skuCode: string | null;
  label: string | null;
  status: BatchRowStatus;
  gtin: string | null;
  catalogProductId: string | null;
  existingCatalogListingId: string | null;
  // Presente só quando status = READY.
  plan: CatalogCreationPlan | null;
  // Motivo quando BLOCKED.
  reason: string | null;
}

export interface BatchPlanResult {
  total: number;
  offset: number;
  limit: number;
  counts: Record<BatchRowStatus, number>;
  rows: BatchPlanRow[];
}

// Sinal interno: a ficha já tem catálogo ativo na conta — o lote não gasta
// chamadas calculando preço para quem não vai criar.
// Consultas ao ML que se repetem entre as variações de um mesmo lote (10/10/2026):
// o frete vem do anúncio de origem (igual para todas as variações) e a tarifa
// depende só de categoria + tipo + preço. Sem isso, um anúncio com ~15 variações
// refazia dezenas de chamadas idênticas e estourava os 90 s do MCP.
interface BatchSharedLookups {
  freight: Map<string, Promise<number>>;
  fees: Map<string, Promise<number>>;
}

function memoized<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    // Falha não fica guardada: a próxima unidade tenta de novo.
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

class ExistingCatalogSignal extends Error {
  constructor(
    readonly gtin: string,
    readonly catalogProductId: string,
    readonly existingCatalogListingId: string,
  ) {
    super('existing catalog listing');
  }
}

export interface CatalogCreationPlan {
  sourceItemId: string;
  variationId: string | null;
  variationLabel: string | null;
  sourceTitle: string | null;
  skuCode: string;
  gtin: string;
  catalogProductId: string;
  catalogProductName: string | null;
  // Já existe anúncio de catálogo ATIVO da conta com esta ficha ou este SKU?
  // (verificação pelo EAN: cada EAN/variação é um catálogo.) Se sim, a
  // criação é recusada (409).
  existingCatalogListingId: string | null;
  categoryId: string;
  listingTypeId: string;
  costPrice: number;
  // MAP do SKU (preço mínimo da marca); null = sem MAP cadastrado.
  mapPrice: number | null;
  taxRatePct: number;
  taxRateSource: 'OVERRIDE' | 'TAX_INTELLIGENCE';
  freightAmount: number;
  targetMarginPct: number;
  price: number;
  feeAmount: number;
  taxAmount: number;
  marginAmount: number;
  marginPct: number;
  initialStock: number;
  warnings: string[];
}

export interface CatalogCreationResult {
  plan: CatalogCreationPlan;
  createdItemId: string | null;
  status: string | null;
}

export interface TraditionalWithoutCatalogRow {
  itemId: string;
  title: string | null;
  skuCode: string | null;
  price: number | null;
  // Já existe anúncio de catálogo ativo da conta com o mesmo SKU?
  hasCatalogListingWithSameSku: boolean;
}

// Criar anúncio de CATÁLOGO pelo EAN (09/10/2026, a pedido do Gui). Ver
// docs/product/ml-catalogo-criar-por-ean.md. Duas operações:
//   - plan(): só LÊ. Nunca escreve no ML.
//   - create(): ESCREVE um anúncio por vez, atrás de flag, recalculando tudo
//     no servidor (o cliente só informa o anúncio de origem).
// Regra pura (preço/GTIN/payload) em domain/ml-catalog-listing-creation.ts.
@Injectable()
export class MlCatalogListingCreationService {
  private readonly logger = new Logger(MlCatalogListingCreationService.name);
  // Trava de duplo envio em memória (1 instância hoje) — mesma limitação
  // conhecida da inscrição em campanhas; ver docs.
  private readonly createsInFlight = new Set<string>();
  private readonly summariesCache = new Map<string, { at: number; data: MlCatalogListingSummary[] }>();
  private readonly summariesInFlight = new Map<string, Promise<MlCatalogListingSummary[]>>();

  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(TAX_RATE_RESOLVER) private readonly taxRates: TaxRateResolver,
    private readonly client: MercadoLivreApiClient,
    private readonly connections: MercadoLivreConnectionService,
  ) {}

  // Anúncios tradicionais ativos da conta (paginado no servidor).
  async listTraditionalWithoutCatalog(
    tenantId: string,
    page: { offset: number; limit: number },
  ): Promise<{ total: number; offset: number; limit: number; items: TraditionalWithoutCatalogRow[] }> {
    const limit = Math.min(Math.max(page.limit, 1), 100);
    const offset = Math.max(page.offset, 0);
    const summaries = await this.loadSellerSummaries(tenantId);
    const catalogSkus = new Set(
      summaries.filter((s) => hasCatalog(s) && s.status === 'active' && s.skuCode).map((s) => s.skuCode as string),
    );
    const rows = summaries
      .filter((s) => !hasCatalog(s) && s.status === 'active')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map<TraditionalWithoutCatalogRow>((s) => ({
        itemId: s.id,
        title: s.title,
        skuCode: s.skuCode,
        price: s.price,
        hasCatalogListingWithSameSku: s.skuCode ? catalogSkus.has(s.skuCode) : false,
      }));
    return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit) };
  }

  async plan(tenantId: string, sourceItemId: string, options: CatalogCreationOptions = {}): Promise<CatalogCreationPlan> {
    return this.planWith(tenantId, sourceItemId, options, false);
  }

  // fresh=true ignora o cache de anúncios da conta (a criação precisa do
  // estado de agora para a trava de duplicidade).
  private async planWith(tenantId: string, sourceItemId: string, options: CatalogCreationOptions, fresh: boolean): Promise<CatalogCreationPlan> {
    const targetMarginPct = this.resolveTargetMargin(options.targetMarginPct);
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const item = await this.client.fetchItemPricingContext(sourceItemId, accessToken);
    await this.assertSourceItem(tenantId, sourceItemId, item);
    const unit = this.pickUnit(sourceItemId, item, options.variationId);
    const catalogListings = await this.loadActiveCatalogListings(tenantId, fresh);
    return this.buildPlan(tenantId, accessToken, sourceItemId, item, unit, options, targetMarginPct, catalogListings);
  }

  // Plano de TODAS as variações de um anúncio (uma linha por variação, com o
  // motivo quando uma não puder ser criada). Só lê.
  async planVariations(tenantId: string, sourceItemId: string, options: CatalogCreationOptions = {}): Promise<VariationPlanRow[]> {
    const targetMarginPct = this.resolveTargetMargin(options.targetMarginPct);
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const item = await this.client.fetchItemPricingContext(sourceItemId, accessToken);
    await this.assertSourceItem(tenantId, sourceItemId, item);
    if (item.variations.length === 0) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} não tem variações — use o plano simples.`);
    }
    const catalogListings = await this.loadActiveCatalogListings(tenantId);
    const rows: VariationPlanRow[] = [];
    // Em série: cada plano faz várias chamadas ao ML (rate limit).
    for (const variation of item.variations) {
      try {
        const unit = this.pickUnit(sourceItemId, item, variation.id);
        const plan = await this.buildPlan(tenantId, accessToken, sourceItemId, item, unit, options, targetMarginPct, catalogListings);
        rows.push({ variationId: variation.id, skuCode: variation.skuCode, label: variation.label, plan, error: null });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        rows.push({ variationId: variation.id, skuCode: variation.skuCode, label: variation.label, plan: null, error: error.message });
      }
    }
    return rows;
  }

  // Plano em LOTE (só leitura): percorre uma página dos tradicionais ativos da
  // conta e planeja cada anúncio simples / cada variação, pelo EAN. É a lista
  // confiável de "o que ainda não tem catálogo" (substitui a do Mercado Turbo).
  // Página pequena de propósito (cada unidade faz várias chamadas ao ML).
  async planBatch(
    tenantId: string,
    page: { offset: number; limit: number },
    options: CatalogCreationOptions = {},
  ): Promise<BatchPlanResult> {
    const limit = Math.min(Math.max(page.limit, 1), BATCH_MAX_ITEMS);
    const offset = Math.max(page.offset, 0);
    const targetMarginPct = this.resolveTargetMargin(options.targetMarginPct);
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const summaries = await this.loadSellerSummaries(tenantId);
    const catalogListings = summaries.filter((x) => hasCatalog(x) && x.status === 'active');
    const traditional = summaries.filter((x) => !hasCatalog(x) && x.status === 'active').sort((a, b) => a.id.localeCompare(b.id));

    const rows: BatchPlanRow[] = [];
    const shared: BatchSharedLookups = { freight: new Map(), fees: new Map() };
    // Em série: rate limit do ML.
    for (const summary of traditional.slice(offset, offset + limit)) {
      const startedAt = Date.now();
      const rowsBefore = rows.length;
      const item = await this.client.fetchItemPricingContext(summary.id, accessToken);
      try {
        await this.assertSourceItem(tenantId, summary.id, item);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        rows.push(this.blockedRow(summary.id, null, summary.skuCode, null, error.message));
        continue;
      }
      const variationIds: (string | undefined)[] = item.variations.length > 0 ? item.variations.map((v) => v.id) : [undefined];
      for (const variationId of variationIds) {
        let unit: CreationUnit | null = null;
        try {
          unit = this.pickUnit(summary.id, item, variationId);
          const plan = await this.buildPlan(tenantId, accessToken, summary.id, item, unit, options, targetMarginPct, catalogListings, true, shared);
          rows.push({
            itemId: summary.id,
            variationId: unit.variationId,
            skuCode: plan.skuCode,
            label: unit.label,
            status: 'READY',
            gtin: plan.gtin,
            catalogProductId: plan.catalogProductId,
            existingCatalogListingId: null,
            plan,
            reason: null,
          });
        } catch (error) {
          if (error instanceof ExistingCatalogSignal) {
            rows.push({
              itemId: summary.id,
              variationId: unit?.variationId ?? null,
              skuCode: unit?.skuCode ?? null,
              label: unit?.label ?? null,
              status: 'ALREADY_HAS_CATALOG',
              gtin: error.gtin,
              catalogProductId: error.catalogProductId,
              existingCatalogListingId: error.existingCatalogListingId,
              plan: null,
              reason: null,
            });
          } else if (error instanceof HttpException) {
            rows.push(this.blockedRow(summary.id, unit?.variationId ?? variationId ?? null, unit?.skuCode ?? null, unit?.label ?? null, error.message));
          } else {
            throw error;
          }
        }
      }
      this.logger.log(
        `Lote de catálogo: anúncio=${summary.id} unidades=${rows.length - rowsBefore} duracaoMs=${Date.now() - startedAt}`,
      );
    }
    const counts: Record<BatchRowStatus, number> = { READY: 0, ALREADY_HAS_CATALOG: 0, BLOCKED: 0 };
    for (const r of rows) counts[r.status] += 1;
    return { total: traditional.length, offset, limit, counts, rows };
  }

  private blockedRow(itemId: string, variationId: string | null, skuCode: string | null, label: string | null, reason: string): BatchPlanRow {
    return {
      itemId,
      variationId,
      skuCode,
      label,
      status: 'BLOCKED',
      gtin: null,
      catalogProductId: null,
      existingCatalogListingId: null,
      plan: null,
      reason,
    };
  }

  // Dono do anúncio de origem: o ML recusa ler dado privado de outro
  // vendedor, mas conferimos aqui para não planejar sobre item alheio.
  private async assertSourceItem(tenantId: string, sourceItemId: string, item: MlItemPricingContext): Promise<void> {
    const sellerId = await this.connections.getSellerId(tenantId);
    if (!item.sellerId || (sellerId && item.sellerId !== sellerId)) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} não pertence à conta conectada.`);
    }
    if (item.isCatalogListing) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} já é de catálogo — a criação parte de um anúncio tradicional.`);
    }
    if (item.status !== 'active') {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} não está ativo (status "${item.status}").`);
    }
    if (!item.categoryId || !item.listingTypeId) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} sem categoria/tipo de anúncio na resposta do ML.`);
    }
  }

  // Unidade que vira anúncio de catálogo: o anúncio inteiro (sem variações)
  // ou UMA variação — cada variação tem SKU e EAN próprios.
  private pickUnit(sourceItemId: string, item: MlItemPricingContext, variationId?: string): CreationUnit {
    if (item.variations.length === 0) {
      if (variationId !== undefined) {
        throw new UnprocessableEntityException(`Anúncio ${sourceItemId} não tem variações; remova variationId.`);
      }
      return { variationId: null, label: null, skuCode: item.skuCode, attributes: item.attributes, where: `Anúncio ${sourceItemId}` };
    }
    if (variationId === undefined) {
      throw new UnprocessableEntityException({
        code: 'ML_ITEM_HAS_VARIATIONS',
        message:
          `Anúncio ${sourceItemId} tem ${item.variations.length} variações; informe variationId. ` +
          `Variações: ${item.variations.map((v) => `${v.id} (${v.skuCode ?? 'sem SKU'}${v.label ? `, ${v.label}` : ''})`).join('; ')}.`,
      });
    }
    const variation = item.variations.find((v) => v.id === variationId);
    if (!variation) {
      throw new UnprocessableEntityException(`Variação ${variationId} não existe no anúncio ${sourceItemId}.`);
    }
    return {
      variationId: variation.id,
      label: variation.label,
      skuCode: variation.skuCode,
      attributes: variation.attributes,
      where: `Variação ${variation.id} do anúncio ${sourceItemId}`,
      diagnostic: `campos da variação no ML: ${variation.rawKeys.join(', ')}; user_product_id: ${variation.userProductId ?? 'ausente'}`,
    };
  }

  private async buildPlan(
    tenantId: string,
    accessToken: string,
    sourceItemId: string,
    item: MlItemPricingContext,
    unit: CreationUnit,
    options: CatalogCreationOptions,
    targetMarginPct: number,
    catalogListings: MlCatalogListingSummary[],
    stopIfExisting = false,
    shared?: BatchSharedLookups,
  ): Promise<CatalogCreationPlan> {
    if (!unit.skuCode) {
      throw new UnprocessableEntityException(`${unit.where} não tem SKU do vendedor — sem SKU não há custo nem vínculo com o Olist.${unit.diagnostic ? ` (${unit.diagnostic})` : ''}`);
    }
    const skuCode = unit.skuCode;
    const gtin = extractGtin(unit.attributes);
    if (!gtin) {
      throw new UnprocessableEntityException(`${unit.where} sem EAN/GTIN válido (8, 12, 13 ou 14 dígitos).`);
    }
    if (!item.sellerId || !item.categoryId || !item.listingTypeId) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} sem seller/categoria/tipo de anúncio na resposta do ML.`);
    }

    const hits = (await this.client.searchCatalogProductsByGtin(gtin, accessToken)).filter(
      (h) => !h.status || h.status === 'active',
    );
    if (hits.length === 0) {
      throw new UnprocessableEntityException(`Não existe ficha de catálogo ativa para o EAN ${gtin}.`);
    }
    if (hits.length > 1) {
      throw new UnprocessableEntityException(
        `EAN ${gtin} corresponde a ${hits.length} fichas de catálogo (${hits.map((h) => h.id).join(', ')}) — escolha manual necessária.`,
      );
    }
    const product = hits[0];
    // Regra do dono (09/10/2026): o EAN consultado precisa levar a uma ficha cujo
    // nome bate com o do anúncio. Se não bater, NÃO cria — o item sai como
    // BLOCKED com o motivo, sem pedir decisão (o EAN do cadastro é que deve ser conferido).
    if (!catalogNameRelatesToTitle(item.title, product.name)) {
      throw new UnprocessableEntityException(
        `EAN ${gtin} leva à ficha ${product.id} ("${product.name}"), que não bate com o anúncio ("${item.title}") — não criado; confira o EAN do SKU ${skuCode}.`,
      );
    }
    const existing = catalogListings.find((s) => s.catalogProductId === product.id || s.skuCode === skuCode);
    if (existing && stopIfExisting) throw new ExistingCatalogSignal(gtin, product.id, existing.id);

    const cost = await this.catalog.findBySku(tenantId, skuCode);
    if (!cost) {
      throw new UnprocessableEntityException(`SKU ${skuCode} não existe no catálogo do Kyneti.`);
    }
    if (!(cost.productCostPrice > 0)) {
      throw new UnprocessableEntityException(`SKU ${skuCode} está sem custo cadastrado.`);
    }

    let taxRate: number;
    let taxRateSource: CatalogCreationPlan['taxRateSource'];
    if (options.taxRatePct !== undefined) {
      if (!Number.isFinite(options.taxRatePct) || options.taxRatePct < 0 || options.taxRatePct >= 100) {
        throw new BadRequestException('taxRatePct deve estar entre 0 e 100.');
      }
      taxRate = options.taxRatePct / 100;
      taxRateSource = 'OVERRIDE';
    } else {
      try {
        const resolved = await this.taxRates.resolve({ tenantId, productId: cost.productId, at: new Date() });
        taxRate = resolved.effectiveRate;
        taxRateSource = 'TAX_INTELLIGENCE';
      } catch (error) {
        throw new UnprocessableEntityException(
          `Não foi possível obter a alíquota do SKU ${skuCode}: ${(error as Error).message} — informe taxRatePct.`,
        );
      }
    }

    // Frete estimado a partir do anúncio de origem (o novo ainda não existe).
    const sellerId = item.sellerId;
    const loadFreight = () => this.client.fetchSellerShippingCost(sellerId, sourceItemId, accessToken);
    const freightAmount = shared ? await memoized(shared.freight, `${sellerId}|${sourceItemId}`, loadFreight) : await loadFreight();
    const categoryId = item.categoryId;
    const listingTypeId = item.listingTypeId;
    const loadFee = (price: number) => this.client.fetchSaleFeeAmount(categoryId, price, listingTypeId, accessToken);
    const feeAt = (price: number) =>
      shared ? memoized(shared.fees, `${categoryId}|${listingTypeId}|${price}`, () => loadFee(price)) : loadFee(price);

    let solved;
    try {
      solved = await solvePriceForMargin({
        costPrice: cost.productCostPrice,
        taxRate,
        freightAmount,
        targetMarginPct,
        feeAt,
      });
    } catch (error) {
      throw new UnprocessableEntityException(`Não foi possível calcular preço com ${targetMarginPct}% de margem: ${(error as Error).message}`);
    }

    // MAP (preço mínimo da marca, Product.mapPrice): o preço inicial nunca fica
    // abaixo dele. Se a margem alvo der menos que o MAP, sobe para o MAP e
    // recalcula tarifa/imposto/margem nesse preço (a margem fica >= alvo).
    const mapPrice = cost.mapPrice ?? null;
    const raisedToMap = mapPrice !== null && solved.price < mapPrice - 0.005;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let { price, feeAmount, taxAmount, marginAmount, marginPct } = solved;
    if (raisedToMap) {
      price = r2(mapPrice);
      feeAmount = r2(await feeAt(price));
      taxAmount = r2(price * taxRate);
      marginAmount = r2(price - cost.productCostPrice - taxAmount - feeAmount - freightAmount);
      marginPct = r2((marginAmount / price) * 100);
    }

    return {
      sourceItemId,
      variationId: unit.variationId,
      variationLabel: unit.label,
      sourceTitle: item.title,
      skuCode,
      gtin,
      catalogProductId: product.id,
      catalogProductName: product.name,
      existingCatalogListingId: existing?.id ?? null,
      categoryId,
      listingTypeId,
      costPrice: cost.productCostPrice,
      mapPrice,
      taxRatePct: Math.round(taxRate * 10000) / 100,
      taxRateSource,
      freightAmount,
      targetMarginPct,
      price,
      feeAmount,
      taxAmount,
      marginAmount,
      marginPct,
      initialStock: INITIAL_STOCK,
      warnings: [
        ...(existing ? [`Já existe o anúncio de catálogo ${existing.id} para esta ficha/SKU — a criação será recusada.`] : []),
        'Categoria do tradicional usada na criação: o ML pode recusar se divergir da ficha de catálogo.',
        mapPrice === null
          ? 'SKU sem MAP cadastrado: o piso de preço da marca NÃO foi verificado — cadastre o MAP ou confira antes de criar.'
          : raisedToMap
            ? `Preço subiu de R$ ${solved.price.toFixed(2)} para o MAP de R$ ${mapPrice.toFixed(2)} (preço mínimo da marca); a margem ficou em ${marginPct.toFixed(2)}%.`
            : `Preço respeita o MAP de R$ ${mapPrice.toFixed(2)} do SKU.`,
        'Preço inicial de cadastro (margem alvo); o preço de venda real vem depois, de uma promoção.',
      ],
    };
  }

  async create(tenantId: string, sourceItemId: string, options: CatalogCreationOptions = {}): Promise<CatalogCreationResult> {
    // Falha fechada: sem a flag, nada é escrito no Mercado Livre.
    if (process.env[CATALOG_CREATE_FLAG] !== 'true') {
      throw new ForbiddenException({
        code: 'ML_CATALOG_CREATE_DISABLED',
        message: 'Criação de anúncios de catálogo no Mercado Livre está desativada neste ambiente.',
      });
    }
    const lockKey = `${tenantId}:${sourceItemId}:${options.variationId ?? ''}`;
    if (this.createsInFlight.has(lockKey)) {
      throw new ConflictException({
        code: 'ML_CATALOG_CREATE_IN_PROGRESS',
        message: `Já existe uma criação em andamento a partir do anúncio ${sourceItemId}${options.variationId ? ` (variação ${options.variationId})` : ''}.`,
      });
    }
    this.createsInFlight.add(lockKey);
    try {
      const plan = await this.planWith(tenantId, sourceItemId, options, true);

      // Anti-duplicidade: o plano acabou de conferir (por ficha e SKU) se já existe
      // catálogo ativo desta variação/EAN.
      if (plan.existingCatalogListingId) {
        throw new ConflictException({
          code: 'ML_CATALOG_LISTING_ALREADY_EXISTS',
          message: `Já existe o anúncio de catálogo ${plan.existingCatalogListingId} para o SKU ${plan.skuCode} / ficha ${plan.catalogProductId}.`,
        });
      }

      // Gate final de MAP: pela construção do plano isto não dispara; é o assert
      // de que nenhum preço abaixo do mínimo da marca chega ao Mercado Livre.
      if (plan.mapPrice !== null && plan.price < plan.mapPrice - 0.005) {
        throw new UnprocessableEntityException({
          code: 'MAP_PRICE_VIOLATION',
          message: `Preço R$ ${plan.price.toFixed(2)} abaixo do MAP de R$ ${plan.mapPrice.toFixed(2)} do SKU ${plan.skuCode} — não criado.`,
        });
      }

      const accessToken = await this.connections.getValidAccessToken(tenantId);
      const payload = buildCatalogItemPayload({
        catalogProductId: plan.catalogProductId,
        categoryId: plan.categoryId,
        price: plan.price,
        listingTypeId: plan.listingTypeId,
        skuCode: plan.skuCode,
      });
      // Auditoria deliberada: escrita real em produção na loja do vendedor.
      this.logger.warn(
        `Escrita em produção: tenant ${tenantId} vai criar anúncio de catálogo (ficha ${plan.catalogProductId}, SKU ${plan.skuCode}, ` +
          `EAN ${plan.gtin}) a R$ ${plan.price.toFixed(2)}, margem ${plan.marginPct.toFixed(2)}%, estoque ${INITIAL_STOCK}.`,
      );
      const result = await this.client.createCatalogItem(accessToken, payload);
      this.logger.warn(`Escrita concluída: anúncio criado ${result.id ?? '?'} (status ${result.status ?? '?'}) para SKU ${plan.skuCode}.`);
      return { plan, createdItemId: result.id ?? null, status: result.status ?? null };
    } finally {
      this.createsInFlight.delete(lockKey);
    }
  }

  private resolveTargetMargin(value: number | undefined): number {
    const v = value ?? DEFAULT_TARGET_MARGIN_PCT;
    if (!Number.isFinite(v) || v < MIN_TARGET_MARGIN_PCT || v >= 100) {
      throw new BadRequestException(`targetMarginPct deve estar entre ${MIN_TARGET_MARGIN_PCT} e 99.`);
    }
    return v;
  }

  private async loadActiveCatalogListings(tenantId: string, fresh = false): Promise<MlCatalogListingSummary[]> {
    const all = await this.loadSellerSummaries(tenantId, fresh);
    return all.filter((x) => hasCatalog(x) && x.status === 'active');
  }

  // Listar todos os anúncios da conta é a parte cara (centenas de chamadas ao
  // ML, 65–145 s medido). Para as leituras (lista e planos):
  //  - cache < 30 min: usa;
  //  - cache entre 30 min e 12 h: usa a lista antiga e atualiza em segundo plano;
  //  - sem cache: espera até 45 s; se não terminar, devolve 202 (ML_CATALOG_LIST_LOADING)
  //    e a leitura continua no servidor — a próxima chamada já encontra o resultado.
  // A criação passa fresh=true: lê de novo, sem cache e sem entrar em leitura alheia.
  private async loadSellerSummaries(tenantId: string, fresh = false): Promise<MlCatalogListingSummary[]> {
    if (fresh) return this.loadAndCacheSummaries(tenantId);
    const cached = this.summariesCache.get(tenantId);
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < SUMMARIES_CACHE_TTL_MS) return cached.data;

    // Entra na leitura em andamento (ex.: o cliente desistiu e repetiu) ou começa uma.
    let load = this.summariesInFlight.get(tenantId);
    if (!load) {
      load = this.loadAndCacheSummaries(tenantId);
      this.summariesInFlight.set(tenantId, load);
      const clear = () => {
        if (this.summariesInFlight.get(tenantId) === load) this.summariesInFlight.delete(tenantId);
      };
      load.then(clear, clear);
    }
    if (cached && age < SUMMARIES_STALE_MAX_MS) {
      load.catch((error: Error) =>
        this.logger.warn(`Atualização em segundo plano da lista de anúncios falhou: tenant=${tenantId} ${error.message}`),
      );
      return cached.data;
    }
    return this.waitOrAccept(load);
  }

  private waitOrAccept(load: Promise<MlCatalogListingSummary[]>): Promise<MlCatalogListingSummary[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new HttpException(
              {
                code: 'ML_CATALOG_LIST_LOADING',
                message:
                  'Lendo a lista de anúncios da conta no Mercado Livre (leva 1 a 3 minutos). A leitura continua no servidor: ' +
                  'repita esta mesma chamada em cerca de 2 minutos.',
              },
              HttpStatus.ACCEPTED,
            ),
          ),
        SUMMARIES_WAIT_MS,
      );
      load.then(
        (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async loadAndCacheSummaries(tenantId: string): Promise<MlCatalogListingSummary[]> {
    const startedAt = Date.now();
    const data = await this.fetchSellerSummaries(tenantId);
    this.summariesCache.set(tenantId, { at: Date.now(), data });
    this.logger.log(
      `Leitura da lista de anúncios da conta concluída: tenant=${tenantId} anuncios=${data.length} duracaoMs=${Date.now() - startedAt}`,
    );
    return data;
  }

  private async fetchSellerSummaries(tenantId: string): Promise<MlCatalogListingSummary[]> {
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const sellerId = await this.connections.getSellerId(tenantId);
    if (!sellerId) {
      throw new UnprocessableEntityException('Conexão com o Mercado Livre inativa ou sem sellerId.');
    }
    let ids = await this.client.fetchSellerItemIds(sellerId, accessToken);
    if (ids.length === 0) {
      const alternative = await this.client.fetchOrderSellerIdSample(sellerId, accessToken);
      if (alternative && alternative !== sellerId) ids = await this.client.fetchSellerItemIds(alternative, accessToken);
    }
    return this.client.fetchCatalogListingSummaries(ids, accessToken);
  }
}
