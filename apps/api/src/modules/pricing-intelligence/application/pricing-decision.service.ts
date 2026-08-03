import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PRICING_STRATEGIST,
  PricingStrategist,
  PricingDecision,
  PricingContext,
  InvalidPricingContextError,
  UnreachableMarginError,
  calculateTieredNetMarginFloorPrice,
  mergeFeeAndShippingBands,
  channelCostsOf,
  netMarginPctOf,
  validatePriceAgainstMap,
  MapPriceViolationError,
} from '../domain/pricing-strategist';
import {
  PRODUCT_CATALOG_READER,
  COMPETITOR_SNAPSHOT_READER,
  CHANNEL_LISTING_READER,
  PRICE_UPDATE_DISPATCHER,
  FINANCIAL_POLICY_READER,
  FEE_RULE_RESOLVER,
  LOGISTICS_COST_READER,
  CHANNEL_CATEGORY_RESOLVER,
  SHIPPING_POLICY_RESOLVER,
  CHANNEL_SELLER_PROFILE_READER,
} from '../../../shared/contracts/tokens';
import { ChannelSellerProfileReader } from '../../../shared/contracts/channel-seller-profile-reader.port';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { CompetitorSnapshotReader } from '../../../shared/contracts/competitor-snapshot-reader.port';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import { PriceUpdateDispatcher, PriceUpdateOutcome } from '../../../shared/contracts/price-update-dispatcher.port';
import { FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';
import {
  FeeRuleResolver,
  ResolvedFeeRule,
  applySellerProfileToTier,
} from '../../../shared/contracts/fee-rule-resolver.port';
import { LogisticsCostReader } from '../../../shared/contracts/logistics-cost-reader.port';
import { ChannelCategoryResolver } from '../../../shared/contracts/channel-category-resolver.port';
import {
  ShippingPolicyResolver,
  resolveSellerFreightCost,
} from '../../../shared/contracts/shipping-policy-resolver.port';

const FINANCIAL_FLOOR_NOTE = 'Preço ajustado para o piso financeiro por proteção de margem.';
const MAP_FLOOR_NOTE = 'Preço ajustado para respeitar a política de MAP (Preço Mínimo Anunciado) do fornecedor.';

// Escopo de fallback quando o produto não tem categoria mapeada para o
// canal: uma MarketplaceRule cadastrada manualmente com scopeKey 'GLOBAL'
// (mesma convenção que o PromotionIntelligenceService já usa desde a
// Sprint 26). É um fallback LEGÍTIMO — alguém cadastrou e validou essa
// regra —, diferente de assumir comissão zero, que seria inventar dado.
const GLOBAL_FEE_SCOPE = 'GLOBAL';

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
    // Três portas adicionadas em 01/08/2026 (docs/revisao-geral-2026-08.md,
    // §1): sem elas o motor calculava piso ignorando a comissão do canal e
    // podia recomendar preço deficitário achando que era seguro.
    @Inject(FEE_RULE_RESOLVER) private readonly feeRules: FeeRuleResolver,
    @Inject(LOGISTICS_COST_READER) private readonly logistics: LogisticsCostReader,
    @Inject(CHANNEL_CATEGORY_RESOLVER) private readonly channelCategories: ChannelCategoryResolver,
    // Política de frete do canal — quem paga a entrega a partir de qual
    // preço (ML: R$79). Sem ela, o piso ignorava o degrau em que o frete
    // vira custo do vendedor.
    @Inject(SHIPPING_POLICY_RESOLVER) private readonly shippingPolicies: ShippingPolicyResolver,
    // O que ESTE vendedor contratou no canal (plano da Amazon, reputação do
    // ML) — muda o custo real sem mudar a regra do canal.
    @Inject(CHANNEL_SELLER_PROFILE_READER) private readonly sellerProfiles: ChannelSellerProfileReader,
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
    return this.dispatchDecision(tenantId, resolved.decision, resolved.channelCode, resolved.mapPrice);
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

    return this.dispatchDecision(tenantId, resolved.decision, resolved.channelCode, resolved.mapPrice);
  }

  private async resolveDecision(
    tenantId: string,
    skuCode: string,
  ): Promise<{
    decision: PricingDecision;
    channelCode: string | null;
    autoRepricingEnabled: boolean;
    mapPrice: number | null;
  } | null> {
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

    // Sem canal não há como saber comissão nem custo logístico — e sem
    // isso qualquer piso calculado seria uma adivinhação. Bloqueia igual
    // aos casos acima, em vez de cair num "canal genérico".
    if (!opportunity.channelCode) {
      this.logger.warn(
        `SKU ${skuCode} (tenant ${tenantId}): monitoramento sem canal definido — não é possível resolver a comissão do marketplace, decisão não calculada.`,
      );
      return null;
    }
    const channelCode = opportunity.channelCode;

    const [feeRule, logisticsCost, shippingPolicy, estimatedFreightCost, sellerProfile] = await Promise.all([
      this.resolveFeeRule(tenantId, product.categoryId, channelCode),
      this.logistics.getTotalLogisticsCost(tenantId, skuCode, channelCode),
      this.shippingPolicies.resolveShippingPolicy({ marketplaceCode: channelCode, tenantId }),
      this.logistics.getEstimatedFreightCost(tenantId, channelCode),
      this.sellerProfiles.getProfile(tenantId, channelCode),
    ]);

    // REGRA DE OURO desta correção (princípio de produto definido pelo
    // usuário em 01/08/2026): o Kyneti NUNCA inventa uma taxa de
    // marketplace. Se a comissão daquele canal/categoria ainda não foi
    // importada e validada, não existe piso confiável — então não se
    // decide preço nenhum. Assumir zero aqui seria reintroduzir
    // exatamente o bug que esta mudança corrige, e de forma silenciosa.
    if (!feeRule) {
      this.logger.warn(
        `SKU ${skuCode} (tenant ${tenantId}): nenhuma regra de comissão VALIDADA para o canal ${channelCode} ` +
          `(categoria interna: ${product.categoryId ?? 'não definida'}) — decisão NÃO calculada. ` +
          'Importe/valide a taxa do marketplace em Marketplace Intelligence antes de precificar neste canal.',
      );
      return null;
    }

    // Une as faixas de comissão com as de frete em segmentos onde os dois
    // são constantes. Sem política de frete cadastrada, o resultado é
    // idêntico às faixas de comissão com frete zero — comportamento igual
    // ao de antes desta mudança, nunca um custo inventado.
    // O perfil do vendedor decide se a tarifa por item do canal se aplica —
    // na Amazon, quem assina o Plano de vendas profissional não paga os
    // R$2/item. Resolvido ANTES de montar os segmentos para que a tarifa já
    // entre correta no piso.
    const tiersForSeller = feeRule.tiers.map((tier) =>
      applySellerProfileToTier(tier, sellerProfile.professionalPlanActive),
    );

    const feeTiers = shippingPolicy
      ? mergeFeeAndShippingBands(
          tiersForSeller,
          shippingPolicy.bands.map((b) => b.minPrice),
          (priceInSegment) =>
            // O desconto por reputação entra aqui: no Mercado Livre, uma
            // conta verde-escuro paga até 70% menos frete que uma conta
            // nova, no mesmo produto e no mesmo preço.
            resolveSellerFreightCost(
              shippingPolicy,
              priceInSegment,
              estimatedFreightCost,
              sellerProfile.freightDiscountPct,
            ),
        )
      : tiersForSeller.map((tier) => ({ ...tier, sellerFreightCost: 0 }));

    // Menor preço a partir do qual o frete grátis vira obrigatório — só
    // para a decisão conseguir explicar o degrau ao usuário.
    const freeShippingThreshold =
      shippingPolicy?.bands.find((b) => b.freeShippingRequired)?.minPrice ?? null;

    const context: PricingContext = {
      skuCode,
      // productCostPrice (SEM embalagem), não costPrice — a embalagem já
      // vem dentro de logisticsCost; usar o custo efetivo aqui contaria a
      // embalagem duas vezes. Mesma disciplina de
      // promotion-intelligence.service.ts.
      costPrice: product.productCostPrice,
      currentPrice: opportunity.ourPrice,
      desiredMarginPct: product.desiredMarginPct,
      minimumMarginPct: product.minimumMarginPct,
      taxRate: policy.taxRate,
      minProfitMargin: policy.minProfitMargin,
      channelCode,
      feeTiers,
      commissionCapAmount: feeRule.commissionCapAmount,
      freeShippingThreshold,
      logisticsCost,
      feeRuleId: feeRule.ruleId,
      feeRuleVersion: feeRule.ruleVersion,
      effectiveCostPriceLegacy: product.costPrice,
      competitorBestPrice: opportunity.bestCompetitorPrice,
      buyBoxStatus: opportunity.buyBoxStatus,
      mapPrice: product.mapPrice,
    };

    let decision: PricingDecision;
    try {
      decision = this.strategist.calculateOptimalPrice(context);
    } catch (error) {
      if (error instanceof InvalidPricingContextError) {
        this.logger.warn(`Contexto de precificação inválido para SKU ${skuCode} (tenant ${tenantId}): ${error.message} — decisão não calculada.`);
        return null;
      }
      // Margem inalcançável não é bug: é o produto não fechar naquele
      // canal com a margem configurada. Vira log explicativo e nenhuma
      // decisão — nunca um preço "melhor esforço" que fura a política.
      if (error instanceof UnreachableMarginError) {
        this.logger.warn(`${error.message} (tenant ${tenantId}) — decisão não calculada.`);
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
    const { floorPrice: financialFloorPrice } = calculateTieredNetMarginFloorPrice(
      context.costPrice,
      policy.minProfitMargin * 100,
      context.feeTiers,
      { taxRate: context.taxRate, logisticsCost: context.logisticsCost },
      skuCode,
      channelCode,
    );
    if (decision.recommendedPrice < financialFloorPrice) {
      this.logger.warn(`SKU ${skuCode} (tenant ${tenantId}): ${FINANCIAL_FLOOR_NOTE} (${decision.recommendedPrice} -> ${financialFloorPrice})`);
      decision = {
        ...decision,
        recommendedPrice: financialFloorPrice,
        resultingMarginPct: netMarginPctOf(financialFloorPrice, context.costPrice, channelCostsOf(context, financialFloorPrice)),
        financialFloorPrice,
        action: 'FINANCIAL_FLOOR_APPLIED',
        hitFinancialFloor: true,
        reason: `${decision.reason} [Governança] ${FINANCIAL_FLOOR_NOTE}`,
      };
    }

    // Defesa em profundidade do MAP — MESMO racional do recheck financeiro
    // acima: é uma invariante de GOVERNANÇA (política do fornecedor, não
    // margem interna), deve valer para QUALQUER PricingStrategist plugado.
    // Encadeado DEPOIS do recheck financeiro de propósito — se o MAP for
    // MAIOR que o piso financeiro já aplicado, ele vence por cima (o efeito
    // final é o mesmo de comparar os três pisos de uma vez, sem precisar de
    // um branch de 3 vias aqui). `product.mapPrice` é a fonte direta (não
    // `context.mapPrice`) para nunca depender de o Strategist ter
    // repassado o campo corretamente.
    if (product.mapPrice !== null && decision.recommendedPrice < product.mapPrice) {
      this.logger.warn(`SKU ${skuCode} (tenant ${tenantId}): ${MAP_FLOOR_NOTE} (${decision.recommendedPrice} -> ${product.mapPrice})`);
      decision = {
        ...decision,
        recommendedPrice: product.mapPrice,
        resultingMarginPct: netMarginPctOf(product.mapPrice, context.costPrice, channelCostsOf(context, product.mapPrice)),
        mapPrice: product.mapPrice,
        action: 'MAP_FLOOR_APPLIED',
        hitMapFloor: true,
        reason: `${decision.reason} [Governança] ${MAP_FLOOR_NOTE}`,
      };
    }

    return {
      decision,
      channelCode: opportunity.channelCode,
      autoRepricingEnabled: product.autoRepricingEnabled,
      mapPrice: product.mapPrice,
    };
  }

  // Resolve a comissão do canal na granularidade mais específica possível,
  // porque é assim que os marketplaces realmente cobram: o Mercado Livre
  // tem percentual diferente por categoria, e o MercadoLivreFeeRuleProvider
  // importa exatamente nesse formato (uma MarketplaceRule por categoria,
  // scopeKey = id externo da categoria).
  //
  // Ordem de tentativa:
  //   1. Categoria do produto traduzida para a categoria do canal
  //      (ChannelCategoryMapping) — o caminho fiel, taxa real daquele nicho.
  //   2. Escopo 'GLOBAL' — regra única cadastrada manualmente para o canal,
  //      mesma convenção do Promotion Intelligence. Menos preciso, mas é
  //      dado que alguém cadastrou e validou de propósito.
  //
  // Não existe passo 3. Se nenhum dos dois responder, devolve null e quem
  // chama aborta a decisão — nunca "estima" uma comissão.
  private async resolveFeeRule(
    tenantId: string,
    internalCategoryId: string | null,
    channelCode: string,
  ): Promise<ResolvedFeeRule | null> {
    if (internalCategoryId) {
      const externalCategoryId = await this.channelCategories.resolveExternalCategoryId(
        tenantId,
        internalCategoryId,
        channelCode,
      );

      if (externalCategoryId) {
        const byCategory = await this.feeRules.resolveFeeRule({
          marketplaceCode: channelCode,
          categoryCode: externalCategoryId,
          tenantId,
        });
        if (byCategory) return byCategory;

        this.logger.debug(
          `Canal ${channelCode}: sem regra de comissão validada para a categoria ${externalCategoryId} — tentando escopo ${GLOBAL_FEE_SCOPE}.`,
        );
      }
    }

    return this.feeRules.resolveFeeRule({
      marketplaceCode: channelCode,
      categoryCode: GLOBAL_FEE_SCOPE,
      tenantId,
    });
  }

  // Único ponto que efetivamente chama PRICE_UPDATE_DISPATCHER — reusado
  // pelo caminho manual e pelo automático, para garantir que os dois se
  // comportem exatamente igual na hora de aplicar (mesma checagem de
  // no-op, mesma resolução de externalId).
  private async dispatchDecision(
    tenantId: string,
    decision: PricingDecision,
    channelCode: string | null,
    mapPrice: number | null,
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

    // Gate FINAL, imediatamente antes de qualquer chamada à API de
    // precificação (PRICE_UPDATE_DISPATCHER) — pedido explícito do usuário:
    // "em hipótese alguma o Kyneti envia um preço abaixo do MAP". Em
    // condições normais isto NUNCA dispara (o piso de MAP já foi aplicado
    // duas vezes antes: dentro do PricingStrategist e na defesa em
    // profundidade de resolveDecision) — é a última linha de defesa contra
    // qualquer bug futuro nas duas camadas anteriores, nunca confiamos numa
    // única camada de validação para uma invariante deste tipo.
    try {
      validatePriceAgainstMap(decision.skuCode, decision.recommendedPrice, mapPrice);
    } catch (error) {
      if (error instanceof MapPriceViolationError) {
        this.logger.error(error.message);
        return {
          decision,
          applied: false,
          reason: error.message,
        };
      }
      throw error;
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
