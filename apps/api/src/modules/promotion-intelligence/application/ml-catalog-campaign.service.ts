import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PRODUCT_CATALOG_READER, TAX_RATE_RESOLVER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { TaxRateResolver } from '../../../shared/contracts/tax-rate-resolver.port';
import {
  MercadoLivreApiClient,
  MlCatalogListingSummary,
  MlItemPricingContext,
  MlItemPromotion,
} from '../../marketplace-intelligence/infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../marketplace-intelligence/application/mercado-livre-connection.service';
import {
  BuyBoxStatus,
  CampaignOption,
  CatalogItemSnapshot,
  DEFAULT_ELIGIBLE_PROMOTION_TYPES,
  ItemPlan,
  MarginBreakdown,
  allowedRange,
  candidatePrices,
  contributionMargin,
  planItem,
  round2,
} from '../domain/ml-catalog-campaign-planner';

// Piso absoluto: nenhuma chamada (nem via MCP) consegue pedir margem mínima
// abaixo de zero. O padrão da rotina do Gui é 5%.
export const DEFAULT_MIN_MARGIN_PCT = 5;

export interface PlanOptions {
  minMarginPct?: number;
  // Alíquota em % (7.3 = 7,3%). Quando ausente, usa a alíquota calculada
  // pelo Tax Intelligence para o produto. Existe porque o Mercado Turbo usa
  // uma alíquota cadastrada à mão e o Gui precisa poder bater os números.
  taxRatePct?: number;
}

export interface ItemCampaignPlanResponse extends ItemPlan {
  title: string | null;
  skuCode: string | null;
  isCatalogListing: boolean;
  costPrice: number;
  taxRatePct: number;
  taxRateSource: 'OVERRIDE' | 'TAX_INTELLIGENCE';
  freightAmount: number;
  buyBoxWinnerPrice: number | null;
  notCompetingReasons: string[];
}

export interface JoinResult {
  itemId: string;
  promotionId: string;
  promotionType: string;
  dealPrice: number;
  margin: MarginBreakdown;
  mercadoLivrePrice: number | null;
}

interface LoadedContext {
  item: MlItemPricingContext;
  snapshot: CatalogItemSnapshot;
  options: CampaignOption[];
  rawPromotions: MlItemPromotion[];
  costPrice: number;
  taxRate: number;
  taxRateSource: 'OVERRIDE' | 'TAX_INTELLIGENCE';
  freightAmount: number;
  winnerPrice: number | null;
  notCompetingReasons: string[];
  accessToken: string;
}

function toBuyBoxStatus(raw: string | null): BuyBoxStatus {
  switch (raw) {
    case 'winning':
    case 'sharing_first_place':
    case 'competing':
    case 'listed':
      return raw;
    default:
      return 'unknown';
  }
}

function toCampaignOption(p: MlItemPromotion): CampaignOption {
  return {
    promotionId: p.id,
    promotionType: p.type,
    name: p.name,
    status: p.status,
    currentDealPrice: ['started', 'pending'].includes(p.status.toLowerCase()) ? p.price : null,
    allowedPriceA: p.minDiscountedPrice,
    allowedPriceB: p.maxDiscountedPrice,
    startDate: p.startDate,
    finishDate: p.finishDate,
  };
}

// "Buy Box + Campanhas" do Mercado Livre (07/10/2026, a pedido do Gui) —
// substitui a rotina manual do Mercado Turbo: para cada anúncio de catálogo,
// decidir em quais campanhas do vendedor/tradicionais entrar e a que preço,
// sem nunca ficar abaixo da margem mínima. Regra pura em
// domain/ml-catalog-campaign-planner.ts; aqui só a orquestração de I/O.
//
// Duas operações:
//   - plan(): só LÊ (ML + catálogo + imposto). Nunca escreve.
//   - join(): ESCREVE no ML uma adesão por vez. Recalcula tudo no servidor —
//     o preço do cliente é só o pedido; tipo da campanha, faixa aceita e
//     margem vêm de dado fresco do ML e do catálogo.
@Injectable()
export class MlCatalogCampaignService {
  private readonly logger = new Logger(MlCatalogCampaignService.name);
  // Trava de duplo envio (tenant+anúncio+campanha) enquanto uma inscrição está em
  // andamento. Em memória: protege requisições concorrentes dentro da mesma
  // instância da API (hoje 1 instância no Render). Com mais instâncias, trocar
  // por trava no banco — limitação conhecida, registrada em docs/product.
  private readonly joinsInFlight = new Set<string>();

  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(TAX_RATE_RESOLVER) private readonly taxRates: TaxRateResolver,
    private readonly client: MercadoLivreApiClient,
    private readonly connections: MercadoLivreConnectionService,
  ) {}

  async plan(tenantId: string, itemId: string, options: PlanOptions = {}): Promise<ItemCampaignPlanResponse> {
    const minMarginPct = this.resolveMinMargin(options.minMarginPct);
    const ctx = await this.load(tenantId, itemId, options.taxRatePct);

    const prices = new Set<number>(candidatePrices(ctx.snapshot, ctx.options));
    for (const o of ctx.options) {
      if (o.currentDealPrice !== null) prices.add(round2(o.currentDealPrice));
    }
    const marginAt = await this.buildMarginFunction(ctx, [...prices]);
    const plan = planItem(ctx.snapshot, ctx.options, marginAt, minMarginPct);

    return {
      ...plan,
      title: ctx.item.title,
      skuCode: ctx.item.skuCode,
      isCatalogListing: ctx.item.isCatalogListing,
      costPrice: ctx.costPrice,
      taxRatePct: round2(ctx.taxRate * 100),
      taxRateSource: ctx.taxRateSource,
      freightAmount: ctx.freightAmount,
      buyBoxWinnerPrice: ctx.winnerPrice,
      notCompetingReasons: ctx.notCompetingReasons,
    };
  }

  // Lista os anúncios de catálogo ATIVOS da conta (a aba "Catálogo" do
  // Mercado Turbo), paginado no servidor. Só leitura.
  async listCatalogItems(
    tenantId: string,
    page: { offset: number; limit: number },
  ): Promise<{ total: number; offset: number; limit: number; items: MlCatalogListingSummary[] }> {
    const limit = Math.min(Math.max(page.limit, 1), 100);
    const offset = Math.max(page.offset, 0);
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const sellerId = await this.connections.getSellerId(tenantId);
    if (!sellerId) {
      throw new UnprocessableEntityException('Conexão com o Mercado Livre inativa ou sem sellerId.');
    }

    let ids = await this.client.fetchSellerItemIds(sellerId, accessToken);
    if (ids.length === 0) {
      // Mesmo fallback do sync de anúncios: o user_id do token nem sempre é
      // o dono dos anúncios (ver MercadoLivreApiClient.fetchOrderSellerIdSample).
      const alternative = await this.client.fetchOrderSellerIdSample(sellerId, accessToken);
      if (alternative && alternative !== sellerId) ids = await this.client.fetchSellerItemIds(alternative, accessToken);
    }

    const summaries = await this.client.fetchCatalogListingSummaries(ids, accessToken);
    const catalog = summaries
      .filter((s) => s.isCatalogListing && s.status === 'active')
      .sort((a, b) => a.id.localeCompare(b.id));
    return { total: catalog.length, offset, limit, items: catalog.slice(offset, offset + limit) };
  }

  async join(
    tenantId: string,
    itemId: string,
    input: { promotionId: string; dealPrice: number; minMarginPct?: number; taxRatePct?: number },
  ): Promise<JoinResult> {
    // Falha fechada (fail-closed): sem ML_CAMPAIGN_WRITES_ENABLED=true no ambiente da
    // API, nenhuma inscrição é escrita no Mercado Livre, por REST ou MCP.
    if (process.env.ML_CAMPAIGN_WRITES_ENABLED !== 'true') {
      throw new ForbiddenException({
        code: 'ML_CAMPAIGN_WRITES_DISABLED',
        message: 'Escrita em campanhas do Mercado Livre está desativada neste ambiente.',
      });
    }
    const minMarginPct = this.resolveMinMargin(input.minMarginPct);
    const dealPrice = round2(input.dealPrice);
    if (!(dealPrice > 0)) throw new BadRequestException('dealPrice deve ser maior que zero.');

    const lockKey = `${tenantId}:${itemId}:${input.promotionId}`;
    if (this.joinsInFlight.has(lockKey)) {
      throw new ConflictException({
        code: 'ML_CAMPAIGN_JOIN_IN_PROGRESS',
        message: `Já existe uma inscrição em andamento do anúncio ${itemId} na campanha ${input.promotionId}.`,
      });
    }
    this.joinsInFlight.add(lockKey);
    try {
      return await this.joinLocked(tenantId, itemId, input, minMarginPct, dealPrice);
    } finally {
      this.joinsInFlight.delete(lockKey);
    }
  }

  private async joinLocked(
    tenantId: string,
    itemId: string,
    input: { promotionId: string; taxRatePct?: number },
    minMarginPct: number,
    dealPrice: number,
  ): Promise<JoinResult> {
    const ctx = await this.load(tenantId, itemId, input.taxRatePct);
    if (ctx.snapshot.availableQuantity <= 0) {
      throw new UnprocessableEntityException(`Anúncio ${itemId} sem estoque — a rotina não altera preço de item sem estoque.`);
    }

    const option = ctx.options.find((o) => o.promotionId === input.promotionId);
    if (!option) {
      throw new NotFoundException(`Campanha ${input.promotionId} não está disponível para o anúncio ${itemId}.`);
    }
    if (!(DEFAULT_ELIGIBLE_PROMOTION_TYPES as readonly string[]).includes(option.promotionType.toUpperCase())) {
      throw new UnprocessableEntityException(`Campanha do tipo ${option.promotionType} está fora da rotina (só SELLER_CAMPAIGN e DEAL).`);
    }
    if (option.status.toLowerCase() !== 'candidate') {
      throw new UnprocessableEntityException(`Anúncio ${itemId} já está com status "${option.status}" na campanha ${option.promotionId}.`);
    }
    const range = allowedRange(option);
    if ((range.high !== null && dealPrice > range.high + 0.005) || (range.low !== null && dealPrice < range.low - 0.005)) {
      throw new UnprocessableEntityException(
        `Preço R$ ${dealPrice.toFixed(2)} fora da faixa aceita pela campanha (R$ ${range.low?.toFixed(2) ?? '?'} a R$ ${range.high?.toFixed(2) ?? '?'}).`,
      );
    }

    const marginAt = await this.buildMarginFunction(ctx, [dealPrice]);
    const margin = marginAt(dealPrice);
    if (margin.marginPct < minMarginPct) {
      throw new UnprocessableEntityException(
        `Margem de contribuição a R$ ${dealPrice.toFixed(2)} seria ${margin.marginPct.toFixed(2)}% (mínimo ${minMarginPct}%). Adesão recusada.`,
      );
    }

    // Auditoria deliberada: escrita real em produção na loja do vendedor.
    this.logger.warn(
      `Escrita em produção: tenant ${tenantId} vai inscrever o anúncio ML ${itemId} (SKU ${ctx.item.skuCode ?? '?'}) ` +
        `na campanha ${option.promotionId} (${option.promotionType}) a R$ ${dealPrice.toFixed(2)}, margem ${margin.marginPct.toFixed(2)}%.`,
    );
    const result = await this.client.joinItemPromotion(itemId, ctx.accessToken, {
      promotionId: option.promotionId,
      promotionType: option.promotionType,
      dealPrice,
    });
    this.logger.warn(`Escrita concluída: anúncio ML ${itemId} na campanha ${option.promotionId}, preço ML ${result.price ?? '?'}.`);

    return {
      itemId,
      promotionId: option.promotionId,
      promotionType: option.promotionType,
      dealPrice,
      margin,
      mercadoLivrePrice: result.price,
    };
  }

  private resolveMinMargin(value: number | undefined): number {
    const v = value ?? DEFAULT_MIN_MARGIN_PCT;
    // Piso fixo: o cliente (usuário ou LLM) pode exigir margem MAIOR, nunca menor.
    if (!Number.isFinite(v) || v < DEFAULT_MIN_MARGIN_PCT || v > 100) {
      throw new BadRequestException(`minMarginPct deve estar entre ${DEFAULT_MIN_MARGIN_PCT} e 100.`);
    }
    return v;
  }

  private async load(tenantId: string, itemId: string, taxRatePctOverride?: number): Promise<LoadedContext> {
    const accessToken = await this.connections.getValidAccessToken(tenantId);
    const item = await this.client.fetchItemPricingContext(itemId, accessToken);

    if (!item.skuCode) {
      throw new UnprocessableEntityException(`Anúncio ${itemId} não tem SKU do vendedor — sem SKU não há custo para calcular margem.`);
    }
    const product = await this.catalog.findBySku(tenantId, item.skuCode);
    if (!product) {
      throw new UnprocessableEntityException(`SKU ${item.skuCode} (anúncio ${itemId}) não existe no catálogo do Kyneti.`);
    }
    if (!item.sellerId || !item.categoryId || !item.listingTypeId) {
      throw new UnprocessableEntityException(`Anúncio ${itemId} sem seller_id/categoria/tipo de anúncio na resposta do ML.`);
    }

    const [priceToWin, promotions, freightAmount] = await Promise.all([
      this.client.fetchPriceToWin(itemId, accessToken).catch((error) => {
        // Anúncio fora de disputa de catálogo responde erro aqui; o
        // planejador segue com status "unknown" (cai em "manter preço").
        this.logger.warn(`price_to_win indisponível para ${itemId}: ${(error as Error).message}`);
        return null;
      }),
      this.client.fetchItemPromotions(itemId, accessToken),
      this.client.fetchSellerShippingCost(item.sellerId, itemId, accessToken),
    ]);

    let taxRate: number;
    let taxRateSource: LoadedContext['taxRateSource'];
    if (taxRatePctOverride !== undefined) {
      if (!Number.isFinite(taxRatePctOverride) || taxRatePctOverride < 0 || taxRatePctOverride >= 100) {
        throw new BadRequestException('taxRatePct deve estar entre 0 e 100.');
      }
      taxRate = taxRatePctOverride / 100;
      taxRateSource = 'OVERRIDE';
    } else {
      try {
        const resolved = await this.taxRates.resolve({ tenantId, productId: product.productId, at: new Date() });
        taxRate = resolved.effectiveRate;
        taxRateSource = 'TAX_INTELLIGENCE';
      } catch (error) {
        throw new UnprocessableEntityException(
          `Não foi possível obter a alíquota do SKU ${item.skuCode}: ${(error as Error).message} — informe taxRatePct.`,
        );
      }
    }

    const currentSellingPrice = priceToWin?.currentPrice ?? item.price;
    if (!currentSellingPrice) {
      throw new UnprocessableEntityException(`Anúncio ${itemId} sem preço atual na resposta do ML.`);
    }

    return {
      item,
      snapshot: {
        itemId,
        availableQuantity: item.availableQuantity,
        currentSellingPrice,
        buyBoxStatus: toBuyBoxStatus(priceToWin?.status ?? null),
        priceToWin: priceToWin?.priceToWin ?? null,
      },
      options: promotions.map(toCampaignOption),
      rawPromotions: promotions,
      // Custo do produto SEM embalagem — é o mesmo número que o Mercado Turbo
      // usa ("Custo"), vindo do Olist.
      costPrice: product.productCostPrice,
      taxRate,
      taxRateSource,
      freightAmount,
      winnerPrice: priceToWin?.winnerPrice ?? null,
      notCompetingReasons: priceToWin?.reasons ?? [],
      accessToken,
    };
  }

  // Busca a tarifa do ML para cada preço candidato (em paralelo, pelo rate
  // limiter do client) e devolve uma função síncrona para o domínio.
  private async buildMarginFunction(ctx: LoadedContext, prices: number[]): Promise<(price: number) => MarginBreakdown> {
    const fees = new Map<number, number>();
    await Promise.all(
      prices.map(async (price) => {
        fees.set(price, await this.client.fetchSaleFeeAmount(ctx.item.categoryId as string, price, ctx.item.listingTypeId as string));
      }),
    );
    return (price: number) => {
      const key = round2(price);
      const fee = fees.get(key);
      if (fee === undefined) {
        throw new Error(`Tarifa do ML não foi buscada para R$ ${key.toFixed(2)} (anúncio ${ctx.item.id}).`);
      }
      return contributionMargin({
        price: key,
        costPrice: ctx.costPrice,
        taxRate: ctx.taxRate,
        feeAmount: fee,
        freightAmount: ctx.freightAmount,
      });
    };
  }
}
