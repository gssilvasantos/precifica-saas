import { Injectable } from '@nestjs/common';
import {
  calculateSafetyFloorPrice,
  calculateFinancialFloorPrice,
  marginPctOf,
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
// 2) Gate de segurança, incondicional: calcula os DOIS pisos — o de produto
//    (minimumMarginPct) e o financeiro do tenant (taxRate + minProfitMargin)
//    — e usa o MAIOR dos dois (o mais restritivo) como piso efetivo. Se a
//    sugestão da fase 1 cair abaixo dele, o piso efetivo VENCE — inclusive
//    protegendo contra o caso do preço atual já estar, por algum motivo
//    (edição manual, dado importado), abaixo do piso. `action` identifica
//    QUAL dos dois pisos foi o decisivo, para a mensagem ficar honesta sobre
//    o motivo real.
@Injectable()
export class DefaultPricingStrategist implements PricingStrategist {
  calculateOptimalPrice(context: PricingContext): PricingDecision {
    validatePricingContext(context);

    const safetyFloorPrice = calculateSafetyFloorPrice(context.costPrice, context.minimumMarginPct);
    const financialFloorPrice = calculateFinancialFloorPrice(context.costPrice, context.taxRate, context.minProfitMargin);
    const effectiveFloorPrice = Math.max(safetyFloorPrice, financialFloorPrice);

    const { rawPrice, rawAction, rawReason } = this.suggestRaw(context);

    const hitFloor = rawPrice < effectiveFloorPrice;
    const recommendedPrice = hitFloor ? effectiveFloorPrice : rawPrice;
    const financialFloorIsStricter = financialFloorPrice > safetyFloorPrice;

    let action = rawAction as PricingDecision['action'];
    let reason = rawReason;
    let hitSafetyFloor = false;
    let hitFinancialFloor = false;

    if (hitFloor) {
      if (financialFloorIsStricter) {
        action = 'FINANCIAL_FLOOR_APPLIED';
        hitFinancialFloor = true;
        reason =
          `${rawReason} Isso furaria o piso financeiro do tenant (imposto ${(context.taxRate * 100).toFixed(1)}% + ` +
          `margem líquida mínima ${(context.minProfitMargin * 100).toFixed(1)}%) — preço ajustado para o piso ` +
          `financeiro por proteção de margem (${recommendedPrice.toFixed(2)}) em vez de ${rawPrice.toFixed(2)}.`;
      } else {
        action = 'SAFETY_FLOOR_APPLIED';
        hitSafetyFloor = true;
        reason = `${rawReason} Isso furaria a margem mínima do produto (${context.minimumMarginPct}%) — preço de segurança aplicado (${recommendedPrice.toFixed(2)}) em vez de ${rawPrice.toFixed(2)}.`;
      }
    }

    return {
      skuCode: context.skuCode,
      action,
      recommendedPrice: round2(recommendedPrice),
      currentPrice: context.currentPrice,
      resultingMarginPct: round2(marginPctOf(recommendedPrice, context.costPrice)),
      safetyFloorPrice: round2(safetyFloorPrice),
      financialFloorPrice: round2(financialFloorPrice),
      hitSafetyFloor,
      hitFinancialFloor,
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
