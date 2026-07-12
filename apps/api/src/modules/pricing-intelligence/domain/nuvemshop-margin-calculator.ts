// Cálculo puro, sem dependência de Nest/Prisma/porta nenhuma — testável
// isoladamente, mesmo padrão de logistics-intelligence/domain/package-weight-calculator.ts.
// Requisito 3 do pedido: simular o impacto de (a) absorver o custo do
// parcelamento e (b) frete grátis/cupom sobre a margem líquida.
export interface MarginScenarioInput {
  grossPrice: number; // preço de venda hoje na Nuvemshop (ChannelListing.currentPrice)
  costPrice: number; // custo do produto (Catalog, via Olist)
  gatewayFeePct: number; // taxa do gateway para a combinação parcelas x janela de recebimento escolhida
  estimatedShippingCost?: number; // custo de frete que a loja absorve, se oferecer frete grátis
  couponCost?: number; // valor de cupom/desconto que a loja absorve
}

export interface MarginScenarioResult {
  grossPrice: number;
  costPrice: number;
  gatewayFeePct: number;
  gatewayFeeAmount: number;
  shippingDeduction: number;
  couponDeduction: number;
  netRevenue: number; // o que sobra do preço de venda depois de taxa + frete + cupom
  netMargin: number; // netRevenue - costPrice, em R$
  netMarginPct: number; // netMargin / grossPrice, em % — convenção de margem sobre preço de venda
}

export class InvalidMarginScenarioError extends Error {
  constructor(reason: string) {
    super(`Cenário de margem inválido: ${reason}`);
    this.name = 'InvalidMarginScenarioError';
  }
}

export function calculateNuvemshopMarginScenario(input: MarginScenarioInput): MarginScenarioResult {
  if (input.grossPrice <= 0) throw new InvalidMarginScenarioError('preço de venda precisa ser maior que zero.');
  if (input.costPrice < 0) throw new InvalidMarginScenarioError('custo não pode ser negativo.');
  if (input.gatewayFeePct < 0 || input.gatewayFeePct > 100) {
    throw new InvalidMarginScenarioError('taxa do gateway precisa estar entre 0 e 100%.');
  }

  const gatewayFeeAmount = round2((input.grossPrice * input.gatewayFeePct) / 100);
  const shippingDeduction = round2(input.estimatedShippingCost ?? 0);
  const couponDeduction = round2(input.couponCost ?? 0);

  const netRevenue = round2(input.grossPrice - gatewayFeeAmount - shippingDeduction - couponDeduction);
  const netMargin = round2(netRevenue - input.costPrice);
  const netMarginPct = round2((netMargin / input.grossPrice) * 100);

  return {
    grossPrice: input.grossPrice,
    costPrice: input.costPrice,
    gatewayFeePct: input.gatewayFeePct,
    gatewayFeeAmount,
    shippingDeduction,
    couponDeduction,
    netRevenue,
    netMargin,
    netMarginPct,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
