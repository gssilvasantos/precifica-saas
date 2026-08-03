import { Injectable } from '@nestjs/common';
import {
  calculateTieredNetMarginFloorPrice,
  channelCostsOf,
  netMarginPctOf,
  tierAtPrice,
  validatePricingContext,
  PricingContext,
  PricingDecision,
  PricingStrategist,
} from './pricing-strategist';

// Estratégia default: "igualar o concorrente quando estamos perdendo o Buy
// Box, mas nunca abaixo de NENHUM dos dois pisos" — a leitura mais direta e
// defensável do pedido, sem inventar agressividade (subcotar por X%) que
// não foi especificada. Reavaliar/trocar por outra implementação de
// PricingStrategist é uma troca de binding no module, não uma mudança
// aqui nem em quem consome.
//
// Algoritmo, em duas fases (a ordem importa — é o que garante a invariante
// "SEMPRE respeita os pisos", não só quando reagimos à concorrência):
//
// 1) Sugestão competitiva "crua": baseada em buyBoxStatus.
//    - LOSING: igualar o concorrente (recommendedPrice = competitorBestPrice).
//    - WINNING ou UNKNOWN: manter o preço atual (recommendedPrice = currentPrice).
// 2) Gate de segurança, incondicional: calcula os TRÊS pisos — o de produto
//    (minimumMarginPct), o financeiro do tenant (taxRate + minProfitMargin)
//    e o de MAP (Product.mapPrice, quando configurado) — e usa o MAIOR dos
//    três (o mais restritivo) como piso efetivo. Se a sugestão da fase 1
//    cair abaixo dele, o piso efetivo VENCE — inclusive protegendo contra o
//    caso do preço atual já estar, por algum motivo (edição manual, dado
//    importado), abaixo do piso. `action` identifica QUAL dos três pisos foi
//    o decisivo, para a mensagem ficar honesta sobre o motivo real. MAP
//    vence empate com os outros dois de propósito: furar a política do
//    fornecedor é uma questão contratual/legal, não só de margem interna —
//    ver validatePriceAgainstMap (gate final, independente deste, chamado
//    por PricingDecisionService antes de qualquer chamada ao marketplace).
@Injectable()
export class DefaultPricingStrategist implements PricingStrategist {
  calculateOptimalPrice(context: PricingContext): PricingDecision {
    validatePricingContext(context);

    const { skuCode, channelCode } = context;
    const flatCosts = { taxRate: context.taxRate, logisticsCost: context.logisticsCost };

    // Os dois pisos agora resolvem a tabela de faixas inteira (problema
    // circular — ver docs/marketplace-fee-model-architecture.md, §6), em vez
    // de receber uma comissão escalar já escolhida por fora.
    const safety = calculateTieredNetMarginFloorPrice(
      context.costPrice,
      context.minimumMarginPct,
      context.feeTiers,
      flatCosts,
      skuCode,
      channelCode,
    );
    const financial = calculateTieredNetMarginFloorPrice(
      context.costPrice,
      context.minProfitMargin * 100,
      context.feeTiers,
      flatCosts,
      skuCode,
      channelCode,
    );

    const safetyFloorPrice = safety.floorPrice;
    const financialFloorPrice = financial.floorPrice;
    const mapPrice = context.mapPrice;
    const effectiveFloorPrice = Math.max(safetyFloorPrice, financialFloorPrice, mapPrice ?? -Infinity);

    const { rawPrice, rawAction, rawReason } = this.suggestRaw(context);

    const hitFloor = rawPrice < effectiveFloorPrice;
    const recommendedPrice = hitFloor ? effectiveFloorPrice : rawPrice;
    const financialFloorIsStricter = financialFloorPrice > safetyFloorPrice;

    let action = rawAction as PricingDecision['action'];
    let reason = rawReason;
    let hitSafetyFloor = false;
    let hitFinancialFloor = false;
    let hitMapFloor = false;

    if (hitFloor) {
      if (mapPrice !== null && effectiveFloorPrice === mapPrice) {
        action = 'MAP_FLOOR_APPLIED';
        hitMapFloor = true;
        reason =
          `${rawReason} Isso furaria o Preço Mínimo Anunciado (MAP) definido pelo fornecedor ` +
          `(${mapPrice.toFixed(2)}) — preço ajustado para respeitar a política de MAP (${recommendedPrice.toFixed(2)}) ` +
          `em vez de ${rawPrice.toFixed(2)}.`;
      } else if (financialFloorIsStricter) {
        action = 'FINANCIAL_FLOOR_APPLIED';
        hitFinancialFloor = true;
        reason =
          `${rawReason} Isso furaria o piso financeiro do tenant (comissão ${(financial.appliedTier.commissionPct * 100).toFixed(1)}% + ` +
          `imposto ${(context.taxRate * 100).toFixed(1)}% + margem líquida mínima ${(context.minProfitMargin * 100).toFixed(1)}%) — ` +
          `preço ajustado para o piso financeiro por proteção de margem (${recommendedPrice.toFixed(2)}) em vez de ${rawPrice.toFixed(2)}.`;
      } else {
        action = 'SAFETY_FLOOR_APPLIED';
        hitSafetyFloor = true;
        reason =
          `${rawReason} Isso furaria a margem LÍQUIDA mínima do produto (${context.minimumMarginPct}%, já descontando ` +
          `comissão de ${(safety.appliedTier.commissionPct * 100).toFixed(1)}% do canal ${channelCode} e ${context.logisticsCost.toFixed(2)} de logística) — ` +
          `preço de segurança aplicado (${recommendedPrice.toFixed(2)}) em vez de ${rawPrice.toFixed(2)}.`;
      }
    }

    // A comissão a reportar é a da faixa em que o preço FINAL caiu — pode
    // ser diferente da faixa que gerou o piso (ex.: piso calculado na faixa
    // barata, mas o preço final subiu para a faixa seguinte).
    const finalTier = tierAtPrice(context.feeTiers, recommendedPrice);
    const finalCosts = channelCostsOf(context, recommendedPrice);

    return {
      skuCode: context.skuCode,
      action,
      recommendedPrice: round2(recommendedPrice),
      currentPrice: context.currentPrice,
      resultingMarginPct: round2(netMarginPctOf(recommendedPrice, context.costPrice, finalCosts)),
      safetyFloorPrice: round2(safetyFloorPrice),
      financialFloorPrice: round2(financialFloorPrice),
      hitSafetyFloor,
      hitFinancialFloor,
      costs: {
        channelCode,
        commissionPct: finalTier.commissionPct,
        fixedFeeAmount: finalTier.fixedFeeAmount,
        logisticsCost: context.logisticsCost,
        taxRate: context.taxRate,
        sellerFreightCost: finalTier.sellerFreightCost,
        freeShippingRequired:
          context.freeShippingThreshold !== null && recommendedPrice >= context.freeShippingThreshold,
        feeRuleId: context.feeRuleId,
        feeRuleVersion: context.feeRuleVersion,
        freeShippingThreshold: context.freeShippingThreshold,
        // Fórmula ANTIGA, reproduzida exatamente como era (custo efetivo =
        // produto + embalagem, dividido por (1 - margem)), só para o "antes
        // x depois" da UI — nunca entra em nenhuma decisão.
        legacyFloorPriceForComparison: round2(
          context.effectiveCostPriceLegacy / (1 - context.minimumMarginPct / 100),
        ),
      },
      mapPrice,
      hitMapFloor,
      reason,
    };
  }

  private suggestRaw(context: PricingContext): { rawPrice: number; rawAction: 'MATCH_COMPETITOR' | 'HOLD_PRICE'; rawReason: string } {
    if (context.buyBoxStatus === 'LOSING' && context.competitorBestPrice !== null) {
      return {
        rawPrice: context.competitorBestPrice,
        rawAction: 'MATCH_COMPETITOR',
        rawReason: `Perdendo o Buy Box para um concorrente a ${context.competitorBestPrice.toFixed(2)} — igualando o preço.`,
      };
    }

    if (context.buyBoxStatus === 'WINNING') {
      return {
        rawPrice: context.currentPrice,
        rawAction: 'HOLD_PRICE',
        rawReason: 'Já vencendo o Buy Box — mantendo o preço atual.',
      };
    }

    return {
      rawPrice: context.currentPrice,
      rawAction: 'HOLD_PRICE',
      rawReason: 'Sem dado de concorrência suficiente (buyBoxStatus UNKNOWN) — mantendo o preço atual.',
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
