// "Motor de Cálculo de Margem" (Sprint 26) — o coração do módulo Promotion
// Intelligence. Duas funções puras, sem I/O, mesmo racional de
// domain/replenishment-advisor.entity.ts e domain/order-margin.ts: toda a
// orquestração (buscar custo, taxa, política fiscal) fica na camada de
// aplicação; aqui só a matemática e a regra de negócio, testável sem mocks.
//
// Fórmula (pedida pelo usuário): M.C. Líquida = Preço - Taxas - Custos - Logística.
// "Custos" = SÓ o custo do produto (Product.costPrice) — o custo de
// embalagem NÃO entra aqui: ele foi deliberadamente movido para dentro de
// "Logística" (ver LogisticsCostReader, shared/contracts/), para nunca
// contar o mesmo custo duas vezes.
export type MarginStatus = 'VERDE' | 'VERMELHO';

export interface MarginInputs {
  promotionalPrice: number;
  costPrice: number; // Product.costPrice — SEM embalagem
  commissionPct: number; // fração (0-1), ResolvedFeeRule.commissionPct
  fixedFeeAmount: number; // valor fixo, ResolvedFeeRule.fixedFeeAmount
  taxRate: number; // fração (0-1), FinancialPolicy.taxRate
  logisticsCost: number; // já composto: embalagem (hierarquia) + custo operacional do warehouse
}

export interface MarginCalculationResult {
  feesAmount: number;
  taxAmount: number;
  netMarginAmount: number;
  netMarginPct: number;
  marginStatus: MarginStatus;
}

export class InvalidMarginInputsError extends Error {}

// M.C. Líquida = Preço - Taxas - Custos - Logística. netMarginPct é sobre o
// preço de venda (mesma convenção de marginPctOf em pricing-strategist.ts —
// nunca sobre o custo, para manter os dois módulos comparáveis).
//
// Zero é tratado como VERMELHO (não como um terceiro estado neutro) — mesmo
// racional defensivo do piso financeiro do PricingStrategist: na dúvida
// (margem exatamente zero = sem lucro nenhum), bloqueia.
export function calculateNetMargin(inputs: MarginInputs): MarginCalculationResult {
  if (inputs.promotionalPrice <= 0) {
    throw new InvalidMarginInputsError('promotionalPrice deve ser maior que zero.');
  }

  const feesAmount = inputs.promotionalPrice * inputs.commissionPct + inputs.fixedFeeAmount;
  const taxAmount = inputs.promotionalPrice * inputs.taxRate;
  const netMarginAmount =
    inputs.promotionalPrice - feesAmount - taxAmount - inputs.costPrice - inputs.logisticsCost;
  const netMarginPct = (netMarginAmount / inputs.promotionalPrice) * 100;
  const marginStatus: MarginStatus = netMarginAmount > 0 ? 'VERDE' : 'VERMELHO';

  return { feesAmount, taxAmount, netMarginAmount, netMarginPct, marginStatus };
}

export interface EnrollmentGateResult {
  allowed: boolean;
  reason: string | null;
}

// "Validação Proativa" pedida pelo usuário — gate puro, mesmo padrão de
// canApprove/canMarkDivergent (Hub de Provas, Sprint 24): a camada de
// aplicação SEMPRE chama isto antes de gravar um PromotionEnrollment como
// APPROVED, nunca decide "na mão" se pode ou não.
export function canEnrollInPromotion(result: MarginCalculationResult): EnrollmentGateResult {
  if (result.marginStatus === 'VERMELHO') {
    return {
      allowed: false,
      reason: `Margem líquida negativa ou zero (${result.netMarginPct.toFixed(1)}%) — adesão à promoção bloqueada.`,
    };
  }
  return { allowed: true, reason: null };
}
