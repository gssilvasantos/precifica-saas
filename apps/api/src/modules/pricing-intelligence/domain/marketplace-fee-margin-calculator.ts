// Cálculo puro, sem dependência de Nest/Prisma/porta nenhuma — testável
// isoladamente, mesmo padrão de nuvemshop-margin-calculator.ts.
//
// Diferente do cálculo da Nuvemshop (que recebe um gatewayFeePct ÚNICO e
// escalar, porque a Nuvemshop não tem comissão de marketplace — só taxa de
// gateway), este calculador recebe o valor de taxa JÁ RESOLVIDO pela tabela
// de faixas do canal (resolveFeeAtPrice, shared/contracts/fee-rule-resolver.port.ts)
// — comissão percentual + taxa fixa já somadas num único totalFeeAmount em
// R$. É o formato comum a Mercado Livre e Shopee (e qualquer canal futuro
// cuja comissão varie por faixa de preço/categoria), por isso vive aqui e
// não dentro do serviço de nenhum canal específico.
export interface MarketplaceFeeMarginScenarioInput {
  grossPrice: number; // preço de venda hoje no canal (ChannelListing.currentPrice)
  costPrice: number; // custo do produto (Catalog, via Olist)
  totalFeeAmount: number; // comissão + taxa fixa já resolvidas para este preço, em R$
}

export interface MarketplaceFeeMarginScenarioResult {
  grossPrice: number;
  costPrice: number;
  feeAmount: number;
  netRevenue: number; // o que sobra do preço de venda depois da taxa do canal
  netMargin: number; // netRevenue - costPrice, em R$
  netMarginPct: number; // netMargin / grossPrice, em % — mesma convenção da Nuvemshop
}

export class InvalidMarginScenarioError extends Error {
  constructor(reason: string) {
    super(`Cenário de margem inválido: ${reason}`);
    this.name = 'InvalidMarginScenarioError';
  }
}

export function calculateMarketplaceFeeMarginScenario(
  input: MarketplaceFeeMarginScenarioInput,
): MarketplaceFeeMarginScenarioResult {
  if (input.grossPrice <= 0) throw new InvalidMarginScenarioError('preço de venda precisa ser maior que zero.');
  if (input.costPrice < 0) throw new InvalidMarginScenarioError('custo não pode ser negativo.');
  if (input.totalFeeAmount < 0) throw new InvalidMarginScenarioError('taxa do canal não pode ser negativa.');

  const feeAmount = round2(input.totalFeeAmount);
  const netRevenue = round2(input.grossPrice - feeAmount);
  const netMargin = round2(netRevenue - input.costPrice);
  const netMarginPct = round2((netMargin / input.grossPrice) * 100);

  return {
    grossPrice: input.grossPrice,
    costPrice: input.costPrice,
    feeAmount,
    netRevenue,
    netMargin,
    netMarginPct,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
