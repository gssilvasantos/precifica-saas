import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PRICING_STRATEGIST,
  PricingStrategist,
  PricingDecision,
  PricingContext,
  InvalidPricingContextError,
  calculateFinancialFloorPrice,
  marginPctOf,
} from '../domain/pricing-strategist';
import {
  PRODUCT_CATALOG_READER,
  COMPETITOR_SNAPSHOT_READER,
  CHANNEL_LISTING_READER,
  PRICE_UPDATE_DISPATCHER,
  FINANCIAL_POLICY_READER,
} from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { CompetitorSnapshotReader } from '../../../shared/contracts/competitor-snapshot-reader.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { PriceUpdateDispatcher, PriceUpdateOutcome } from '../../../shared/contracts/price-update-dispatcher.port';
import { FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';

const FINANCIAL_FLOOR_NOTE = 'Preço ajustado para o piso financeiro por proteção de margem.';

// Resultado de aplicar (ou tentar aplicar) uma PricingDecision — vive na
// camada de aplicação, não no domínio puro (domain/pricing-strategist.ts):
// "aplicado ou não" e "em qual canal" são conceitos de orquestração/I-O, o
// Strategist continua sem saber que isso existe (ver seção 4 do doc de
// arquitetura).
export interface ApplyDecisionResult {
  decision: PricingDecision;
  applied: boolean;
  reason: string;
  dispatchOutcome?: PriceUpdateOutcome;
}

// Camada de aplicação — a única que sabe montar um PricingContext a partir
// de OUTROS módulos, e a única que sabe DISPARAR a aplicação de uma decisão
// via PRICE_UPDATE_DISPATCHER. Conhece quatro portas (PRODUCT_CATALOG_READER,
// COMPETITOR_SNAPSHOT_READER, CHANNEL_LISTING_READER, PRICE_UPDATE_DISPATCHER),
// nunca um MarketplaceProvider, nunca a tabela de nenhum outro bounded
// context. O PricingStrategist (domínio puro) só recebe o PricingContext já
// pronto — ver comentário em domain/pricing-strategist.ts.
@Injectable()
export class PricingDecisionService {
  private readonly logger = new Logger(PricingDecisionService.name);

  constructor(
    @Inject(PRICING_STRATEGIST) private readonly strategist: PricingStrategist,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(COMPETITOR_SNAPSHOT_READER) private readonly competitorSnapshots: CompetitorSnapshotReader,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(PRICE_UPDATE_DISPATCHER) private readonly priceUpdateDispatcher: PriceUpdateDispatcher,
    @Inject(FINANCIAL_POLICY_READER) private readonly financialPolicy: FinancialPolicyReader,
  ) {}

  // Só calcula e devolve — nunca dispara PRICE_UPDATE_DISPATCHER. Usado pelo
  // GET de inspeção e internamente pelos dois métodos abaixo. Retorna null
  // quando ainda não há dado suficiente para decidir — nunca lança exceção
  // nesse caso (situação esperada: produto sem monitoramento configurado
  // ainda, ou sem preço vinculado a um canal). Mesma filosofia de
  // "resultado de negócio, não exceção" do PriceUpdateDispatcher (Etapa 8).
  async decide(tenantId: string, skuCode: string): Promise<PricingDecision | null> {
    const resolved = await this.resolveDecision(tenantId, skuCode);
    return resolved?.decision ?? null;
  }

  // Aplicação MANUAL — usada pelo endpoint POST /pricing-intelligence/apply/:skuCode.
  // SEMPRE dispara (quando há uma mudança de preço real a aplicar), não
  // importa o valor de autoRepricingEnabled: é exatamente o botão "Aplicar
  // Preço Agora" para quando a automação está desligada. Recalcula a
  // decisão na hora (não reaproveita uma decisão antiga) para não aplicar
  // um preço baseado em dado desatualizado.
  async applyDecision(tenantId: string, skuCode: string): Promise<ApplyDecisionResult | null> {
    const resolved = await this.resolveDecision(tenantId, skuCode);
    if (!resolved) return null;
    return this.dispatchDecision(tenantId, resolved.decision, resolved.channelCode);
  }

  // Aplicação AUTOMÁTICA — usada pelo CompetitorSignalListener ao reagir a
  // um sinal de concorrência. Só dispara se o produto tiver
  // autoRepricingEnabled = true; senão devolve a decisão calculada com
  // applied: false e o motivo, exatamente como antes desta etapa (log-only).
  async decideAndMaybeApply(tenantId: string, skuCode: string): Promise<ApplyDecisionResult | null> {
    const resolved = await this.resolveDecision(tenantId, skuCode);
    if (!resolved) return null;

    if (!resolved.autoRepricingEnabled) {
      return {
        decision: resolved.decision,
        applied: false,
        reason: `Automação desativada para o SKU ${skuCode} (Product.autoRepricingEnabled = false) — decisão calculada, mas não aplicada.`,
      };
    }

    return this.dispatchDecision(tenantId, resolved.decision, resolved.channelCode);
  }

  private async resolveDecision(
    tenantId: string,
    skuCode: string,
  ): Promise<{ decision: PricingDecision; channelCode: string | null; autoRepricingEnabled: boolean } | null> {
    const [product, opportunity, policy] = await Promise.all([
      this.catalog.findBySku(tenantId, skuCode),
      this.competitorSnapshots.findOpportunity(tenantId, skuCode),
      this.financialPolicy.getPolicy(tenantId),
    ]);

    if (!product) {
      this.logger.warn(`Nenhum produto encontrado para SKU ${skuCode} (tenant ${tenantId}) — decisão não calculada.`);
      return null;
    }
    if (!opportunity) {
      this.logger.warn(`Sem oportunidade competitiva conhecida para SKU ${skuCode} (tenant ${tenantId}) ainda — decisão não calculada.`);
      return null;
    }
    if (opportunity.ourPrice === null) {
      this.logger.warn(`SKU ${skuCode} (tenant ${tenantId}) tem oportunidade competitiva, mas sem preço nosso vinculado (channelCode ausente no monitoramento) — decisão não calculada.`);
      return null;
    }

    const context: PricingContext = {
      skuCode,
      costPrice: product.costPrice,
      currentPrice: opportunity.ourPrice,
      desiredMarginPct: product.desiredMarginPct,
      minimumMarginPct: product.minimumMarginPct,
      taxRate: policy.taxRate,
      minProfitMargin: policy.minProfitMargin,
      competitorBestPrice: opportunity.bestCompetitorPrice,
      buyBoxStatus: opportunity.buyBoxStatus,
    };

    let decision: PricingDecision;
    try {
      decision = this.strategist.calculateOptimalPrice(context);
    } catch (error) {
      if (error instanceof InvalidPricingContextError) {
        this.logger.warn(`Contexto de precificação inválido para SKU ${skuCode} (tenant ${tenantId}): ${error.message} — decisão não calculada.`);
        return null;
      }
      throw error;
    }

    // Defesa em profundidade (pedido explícito): o piso financeiro do
    // tenant é uma invariante de GOVERNANÇA — deve valer para QUALQUER
    // PricingStrategist plugado, não só para o DefaultPricingStrategist
    // (que já aplica isso internamente, ver domain/default-pricing-strategist.ts).
    // Este gate reforça a mesma regra aqui, de forma independente da
    // implementação da estratégia, para que um Strategist futuro/customizado
    // que não implemente o piso financeiro corretamente não consiga
    // contornar a governança do tenant.
    const financialFloorPrice = calculateFinancialFloorPrice(product.costPrice, policy.taxRate, policy.minProfitMargin);
    if (decision.recommendedPrice < financialFloorPrice) {
      this.logger.warn(`SKU ${skuCode} (tenant ${tenantId}): ${FINANCIAL_FLOOR_NOTE} (${decision.recommendedPrice} -> ${financialFloorPrice})`);
      decision = {
        ...decision,
        recommendedPrice: financialFloorPrice,
        resultingMarginPct: marginPctOf(financialFloorPrice, product.costPrice),
        financialFloorPrice,
        action: 'FINANCIAL_FLOOR_APPLIED',
        hitFinancialFloor: true,
        reason: `${decision.reason} [Governança] ${FINANCIAL_FLOOR_NOTE}`,
      };
    }

    return {
      decision,
      channelCode: opportunity.channelCode,
      autoRepricingEnabled: product.autoRepricingEnabled,
    };
  }

  // Único ponto que efetivamente chama PRICE_UPDATE_DISPATCHER — reusado
  // pelo caminho manual e pelo automático, para garantir que os dois se
  // comportem exatamente igual na hora de aplicar (mesma checagem de
  // no-op, mesma resolução de externalId).
  private async dispatchDecision(
    tenantId: string,
    decision: PricingDecision,
    channelCode: string | null,
  ): Promise<ApplyDecisionResult> {
    if (decision.recommendedPrice === decision.currentPrice) {
      return {
        decision,
        applied: false,
        reason: 'Preço recomendado é igual ao preço atual — nada para aplicar.',
      };
    }

    if (!channelCode) {
      return {
        decision,
        applied: false,
        reason: `Nenhum canal vinculado ao monitoramento de concorrência do SKU ${decision.skuCode} — não há onde aplicar o preço.`,
      };
    }

    const listing = await this.channelListings.findBySku(tenantId, channelCode, decision.skuCode);
    if (!listing) {
      return {
        decision,
        applied: false,
        reason: `Nenhum anúncio encontrado no canal ${channelCode} para o SKU ${decision.skuCode} — não há externalId para aplicar o preço.`,
      };
    }

    const dispatchOutcome = await this.priceUpdateDispatcher.dispatch({
      tenantId,
      marketplaceCode: channelCode,
      skuCode: decision.skuCode,
      externalId: listing.externalId,
      newPrice: decision.recommendedPrice,
    });

    return {
      decision,
      applied: dispatchOutcome.success,
      reason: dispatchOutcome.success
        ? `Preço aplicado no canal ${channelCode} via PRICE_UPDATE_DISPATCHER.`
        : `PRICE_UPDATE_DISPATCHER não conseguiu aplicar: ${dispatchOutcome.message ?? 'motivo não informado.'}`,
      dispatchOutcome,
    };
  }
}
