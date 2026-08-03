// Porta consumida pelo Pricing Intelligence (motor de repricing e simulador)
// e pelo Promotion Intelligence — é a ÚNICA coisa que o motor de preço
// conhece do Marketplace Intelligence. Não importa MarketplaceProvider, não
// importa nenhum model Prisma daquele módulo.
//
// Ver docs/marketplace-fee-model-architecture.md para o desenho completo
// (como cada um dos 7 canais cobra e por que a taxa precisa ser uma tabela).

// Uma faixa de preço da tabela de comissão. UNIDADE de commissionPct:
// FRAÇÃO (0.14 = 14%), nunca percentual — ver §3.2 do doc de arquitetura.
export interface ResolvedFeeTier {
  minPrice: number; // inclusive
  maxPrice: number | null; // exclusive; null = última faixa
  commissionPct: number;
  // Tarifa por item cobrada de todo vendedor nesta faixa.
  fixedFeeAmount: number;
  // Tarifa por item cobrada só de quem NÃO assina o plano do canal
  // (Amazon: R$2/item no Individual, zero no Plano de vendas profissional).
  // Ver applySellerProfileToTier.
  planWaivablePerItemFee?: number;
}

// Aplica o perfil do vendedor sobre uma faixa, resolvendo a tarifa que o
// plano isenta. Função pura e no contrato (não num módulo) porque tanto o
// motor de preço quanto o de promoções precisam da MESMA resposta para
// "quanto este vendedor paga por item nesta faixa" — reimplementar dos dois
// lados é como nasceria uma divergência.
export function applySellerProfileToTier(
  tier: ResolvedFeeTier,
  professionalPlanActive: boolean,
): ResolvedFeeTier {
  const waivable = tier.planWaivablePerItemFee ?? 0;
  return {
    ...tier,
    // Plano ativo: a tarifa por item some (o custo virou a mensalidade
    // fixa, que é despesa do Financial Intelligence). Plano inativo: soma.
    fixedFeeAmount: tier.fixedFeeAmount + (professionalPlanActive ? 0 : waivable),
    planWaivablePerItemFee: 0,
  };
}

// Sobre o que a comissão incide. ITEM_PRICE_PLUS_SHIPPING é o caso da
// Amazon (cobra sobre o total pago pelo comprador, frete incluído).
export type ResolvedCommissionBase = 'ITEM_PRICE' | 'ITEM_PRICE_PLUS_SHIPPING';

export interface ResolvedFeeRule {
  // A tabela INTEIRA, não a faixa de um preço específico. Quem precisa da
  // taxa a um preço dado chama resolveFeeAtPrice; quem precisa calcular um
  // PISO precisa da tabela toda, porque o preço ainda não é conhecido — é o
  // problema circular descrito na §6 do doc de arquitetura.
  tiers: ResolvedFeeTier[];
  commissionBase: ResolvedCommissionBase;
  // Teto de comissão por item, quando o canal aplica (Shopee tinha R$100
  // até 2025). null = sem teto.
  commissionCapAmount: number | null;
  ruleId: string; // auditoria: qual MarketplaceRule.id gerou este resultado
  ruleVersion: number;
}

// A taxa efetiva a um preço concreto — resultado de aplicar a tabela.
export interface FeeAtPrice {
  commissionPct: number;
  fixedFeeAmount: number;
  // Valor em R$ da comissão já com teto aplicado, quando houver.
  commissionAmount: number;
  totalFeeAmount: number; // comissão + taxa fixa
}

export class NoFeeTierForPriceError extends Error {
  constructor(price: number) {
    super(
      `Nenhuma faixa de comissão cobre o preço ${price.toFixed(2)} — a tabela de taxas do canal está incompleta. ` +
        'Isso não deveria acontecer: o validador exige faixas contíguas cobrindo de 0 ao infinito.',
    );
    this.name = 'NoFeeTierForPriceError';
  }
}

// Função pura — a faixa que vale para um preço. Vive no contrato (e não
// dentro de um módulo) porque tanto Pricing quanto Promotions precisam dela
// e nenhum dos dois deve reimplementar a regra de "qual faixa se aplica".
export function resolveFeeAtPrice(rule: ResolvedFeeRule, price: number, shippingAmount = 0): FeeAtPrice {
  const tier = rule.tiers.find((t) => price >= t.minPrice && (t.maxPrice === null || price < t.maxPrice));
  if (!tier) throw new NoFeeTierForPriceError(price);

  const commissionableAmount = rule.commissionBase === 'ITEM_PRICE_PLUS_SHIPPING' ? price + shippingAmount : price;

  const rawCommission = commissionableAmount * tier.commissionPct;
  const commissionAmount =
    rule.commissionCapAmount !== null ? Math.min(rawCommission, rule.commissionCapAmount) : rawCommission;

  return {
    commissionPct: tier.commissionPct,
    fixedFeeAmount: tier.fixedFeeAmount,
    commissionAmount,
    totalFeeAmount: commissionAmount + tier.fixedFeeAmount,
  };
}

export interface FeeRuleResolver {
  resolveFeeRule(params: {
    marketplaceCode: string;
    categoryCode: string;
    tenantId: string;
    // Tipo de anúncio, quando o canal diferencia (ML: gold_special =
    // Clássico, gold_pro = Premium — até 5 pontos percentuais de
    // diferença). Quando informado, tenta primeiro a regra específica
    // daquele tipo e cai para a regra da categoria.
    listingTypeId?: string;
    atDate?: Date; // default: agora
  }): Promise<ResolvedFeeRule | null>; // null = nenhuma regra validada disponível ainda
}
