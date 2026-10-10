import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
} from '../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../marketplace-intelligence/application/mercado-livre-connection.service';
import {
  DEFAULT_TARGET_MARGIN_PCT,
  INITIAL_STOCK,
  buildCatalogItemPayload,
  extractGtin,
  solvePriceForMargin,
} from '../domain/ml-catalog-listing-creation';

// Flag PRÓPRIA da criação de anúncios (separada da de campanhas): ligar uma
// não liga a outra. Falha fechada — só o texto exato "true" libera.
export const CATALOG_CREATE_FLAG = 'ML_CATALOG_LISTING_CREATE_ENABLED';
// Piso: a criação nunca aceita margem alvo abaixo disto (o padrão é 40).
const MIN_TARGET_MARGIN_PCT = 5;

export interface CatalogCreationOptions {
  targetMarginPct?: number;
  taxRatePct?: number;
}

export interface CatalogCreationPlan {
  sourceItemId: string;
  sourceTitle: string | null;
  skuCode: string;
  gtin: string;
  catalogProductId: string;
  catalogProductName: string | null;
  categoryId: string;
  listingTypeId: string;
  costPrice: number;
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
      summaries.filter((s) => s.isCatalogListing && s.status === 'active' && s.skuCode).map((s) => s.skuCode as string),
    );
    const rows = summaries
      .filter((s) => !s.isCatalogListing && s.status === 'active')
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
    const targetMarginPct = this.resolveTargetMargin(options.targetMarginPct);
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const item = await this.client.fetchItemPricingContext(sourceItemId, accessToken);

    // Dono do anúncio de origem: o ML recusa ler dado privado de outro
    // vendedor, mas conferimos aqui para não planejar sobre item alheio.
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
    if (!item.skuCode) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} não tem SKU do vendedor — sem SKU não há custo nem vínculo com o Olist.`);
    }
    if (!item.categoryId || !item.listingTypeId) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} sem categoria/tipo de anúncio na resposta do ML.`);
    }
    const gtin = extractGtin(item.attributes);
    if (!gtin) {
      throw new UnprocessableEntityException(`Anúncio ${sourceItemId} sem EAN/GTIN válido (8, 12, 13 ou 14 dígitos).`);
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

    const cost = await this.catalog.findBySku(tenantId, item.skuCode);
    if (!cost) {
      throw new UnprocessableEntityException(`SKU ${item.skuCode} não existe no catálogo do Kyneti.`);
    }
    if (!(cost.productCostPrice > 0)) {
      throw new UnprocessableEntityException(`SKU ${item.skuCode} está sem custo cadastrado.`);
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
          `Não foi possível obter a alíquota do SKU ${item.skuCode}: ${(error as Error).message} — informe taxRatePct.`,
        );
      }
    }

    // Frete estimado a partir do anúncio de origem (o novo ainda não existe).
    const freightAmount = await this.client.fetchSellerShippingCost(item.sellerId, sourceItemId, accessToken);
    const categoryId = item.categoryId;
    const listingTypeId = item.listingTypeId;

    let solved;
    try {
      solved = await solvePriceForMargin({
        costPrice: cost.productCostPrice,
        taxRate,
        freightAmount,
        targetMarginPct,
        feeAt: (price) => this.client.fetchSaleFeeAmount(categoryId, price, listingTypeId),
      });
    } catch (error) {
      throw new UnprocessableEntityException(`Não foi possível calcular preço com ${targetMarginPct}% de margem: ${(error as Error).message}`);
    }

    return {
      sourceItemId,
      sourceTitle: item.title,
      skuCode: item.skuCode,
      gtin,
      catalogProductId: product.id,
      catalogProductName: product.name,
      categoryId,
      listingTypeId,
      costPrice: cost.productCostPrice,
      taxRatePct: Math.round(taxRate * 10000) / 100,
      taxRateSource,
      freightAmount,
      targetMarginPct,
      price: solved.price,
      feeAmount: solved.feeAmount,
      taxAmount: solved.taxAmount,
      marginAmount: solved.marginAmount,
      marginPct: solved.marginPct,
      initialStock: INITIAL_STOCK,
      warnings: [
        'Categoria do tradicional usada na criação: o ML pode recusar se divergir da ficha de catálogo.',
        'Piso de preço de marca (ex.: Catharine Hill) NÃO é verificado aqui — confira antes de criar.',
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
    const lockKey = `${tenantId}:${sourceItemId}`;
    if (this.createsInFlight.has(lockKey)) {
      throw new ConflictException({
        code: 'ML_CATALOG_CREATE_IN_PROGRESS',
        message: `Já existe uma criação em andamento a partir do anúncio ${sourceItemId}.`,
      });
    }
    this.createsInFlight.add(lockKey);
    try {
      const plan = await this.plan(tenantId, sourceItemId, options);

      // Anti-duplicidade: já existe anúncio de catálogo ativo com este SKU ou esta ficha?
      const summaries = await this.loadSellerSummaries(tenantId);
      const duplicate = summaries.find(
        (s) =>
          s.isCatalogListing &&
          s.status === 'active' &&
          (s.skuCode === plan.skuCode || s.catalogProductId === plan.catalogProductId),
      );
      if (duplicate) {
        throw new ConflictException({
          code: 'ML_CATALOG_LISTING_ALREADY_EXISTS',
          message: `Já existe o anúncio de catálogo ${duplicate.id} para o SKU ${plan.skuCode} / ficha ${plan.catalogProductId}.`,
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

  private async loadSellerSummaries(tenantId: string): Promise<MlCatalogListingSummary[]> {
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
