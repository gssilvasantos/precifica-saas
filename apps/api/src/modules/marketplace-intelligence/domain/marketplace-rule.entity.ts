export type RuleType = 'FEE_RULE' | 'SHIPPING_POLICY' | 'CATEGORY_TAXONOMY';

// scopeKey composto para canais que cobram comissão diferente por tipo de
// anúncio (hoje só o Mercado Livre: Clássico 10-14% × Premium 15-19%).
// Função única para gravação (provider) e leitura (RuleRegistryService)
// nunca divergirem no separador — um '#' de diferença entre os dois lados
// faria toda regra Premium virar invisível, silenciosamente.
export const FEE_SCOPE_SEPARATOR = '#';

export function buildFeeScopeKey(categoryCode: string, listingTypeId: string): string {
  return `${categoryCode}${FEE_SCOPE_SEPARATOR}${listingTypeId}`;
}
export type DataSourceType = 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL';
export type RuleStatus = 'PENDENTE_VALIDACAO' | 'VALIDADA' | 'DESATUALIZADA' | 'OBSOLETA';

// Uma faixa de preço da tabela de comissão do canal. Ver
// docs/marketplace-fee-model-architecture.md, §3.
//
// Existe porque NENHUM dos sete canais mapeados cobra uma comissão
// constante: a Shopee cobra 20% até R$79,99 e 14% acima (com taxa fixa
// indo de R$4 a R$26 conforme a faixa), o Mercado Livre tem limiar em
// R$79, a Amazon varia por preço. Guardar um escalar só era correto para
// um canal que não existe.
export interface FeeTier {
  minPrice: number; // inclusive
  maxPrice: number | null; // exclusive; null = última faixa, sem teto
  // UNIDADE: FRAÇÃO (0.14 = 14%), nunca percentual. Ver §3.2 do doc — a
  // ambiguidade antiga (validador aceitava 0-100, consumidores tratavam
  // como fração) era um bug latente que só não estourou porque nenhuma
  // regra real do ML chegou a ser validada em produção.
  commissionPct: number;
  // Tarifa por item que TODO vendedor paga nesta faixa, independente de
  // plano contratado (Shopee: R$4 a R$26 conforme a faixa de preço).
  fixedFeeAmount: number;
  // Tarifa por item cobrada APENAS de quem NÃO assina o plano do canal.
  //
  // Caso real: a Amazon cobra R$2 por item vendido no plano Individual e
  // nada por item no "Plano de vendas profissional" (que custa R$19/mês
  // fixos — despesa mensal, não taxa por venda; por isso o R$19 pertence
  // ao FixedExpense do Financial Intelligence, não a esta tabela).
  //
  // Fica separado de fixedFeeAmount porque só ESTE valor é dispensado pelo
  // plano — somar os dois num campo só tornaria impossível saber o que
  // isentar. Quem decide se aplica é o perfil do vendedor no canal
  // (ChannelSellerProfile.professionalPlanActive), nunca a regra: a regra
  // descreve como o CANAL cobra, o perfil descreve o que ESTE vendedor
  // contratou.
  planWaivablePerItemFee?: number;
}

// Sobre O QUE a comissão incide. Não é um parâmetro cosmético: muda a
// fórmula do cálculo de margem e do piso de preço.
//
// - ITEM_PRICE: comissão sobre o preço do produto. Mercado Livre, Shopee,
//   Magalu, Shein, TikTok Shop.
// - ITEM_PRICE_PLUS_SHIPPING: comissão sobre o total pago pelo comprador,
//   frete incluído. É o caso da AMAZON — tratar como ITEM_PRICE ali
//   subestimaria a comissão em todo pedido com frete cobrado.
//
// Default ITEM_PRICE por ser o caso de 6 dos 7 canais mapeados; o payload
// antigo (sem o campo) continua correto sem migração.
export type CommissionBase = 'ITEM_PRICE' | 'ITEM_PRICE_PLUS_SHIPPING';

export interface FeeRulePayload {
  // Ordenadas por minPrice, contíguas, sem buraco nem sobreposição —
  // garantido pelo validador, nunca assumido por quem lê.
  tiers: FeeTier[];
  commissionBase: CommissionBase;
  // Tipo de anúncio, quando o canal diferencia (ML: gold_special =
  // Clássico 10-14%, gold_pro = Premium 15-19%). A diferença entre os dois
  // é maior que a variação entre muitas categorias — por isso vira parte
  // do scopeKey, não um detalhe do payload.
  listingTypeId?: string;
  // Teto de comissão por item, quando o canal aplica (a Shopee tinha
  // R$100 até 2025 e removeu em 2026 — o campo fica porque esse tipo de
  // política volta).
  commissionCapAmount?: number | null;
  // Só sobrevive do formato escalar antigo, para auditoria de onde veio o
  // número. Não participa de nenhum cálculo.
  referencePrice?: number;
}

// ============================================================================
// SHIPPING_POLICY — quem paga o frete, e a partir de qual preço
// (docs/marketplace-fee-model-architecture.md, §2.0 e §7)
// ============================================================================
//
// É uma regra SEPARADA da FEE_RULE de propósito: comissão é o que o canal
// cobra pela venda; frete é quem arca com a entrega. Os dois variam por
// faixa de preço, mas por motivos diferentes e com limiares diferentes — no
// Mercado Livre a comissão muda por categoria enquanto o frete vira
// obrigação do vendedor em R$79, um número que não tem nada a ver com
// categoria.
//
// Casos reais que este formato precisa representar:
//   - Mercado Livre: R$19-78,99 o canal cobre 100%; a partir de R$79 o
//     frete grátis é obrigatório e o vendedor paga (com desconto de até 70%
//     conforme reputação — ver sellerReputationDiscountPct em
//     resolveSellerFreightCost).
//   - Shopee (desde mar/2026): frete grátis obrigatório em tudo, canal
//     subsidia 30-60% conforme região, com TETO — o exemplo público é frete
//     de R$22 em que a Shopee cobre R$20 e o vendedor paga R$2.
export interface ShippingBand {
  minPrice: number; // inclusive
  maxPrice: number | null; // exclusive; null = última faixa
  // O comprador vê frete grátis nesta faixa. Quando true, o custo não some
  // — ele passa para o vendedor, no que o subsídio abaixo não cobrir.
  freeShippingRequired: boolean;
  // Fração do frete que o CANAL cobre (0 a 1). 1 = canal paga tudo (caso do
  // ML entre R$19 e R$78,99), 0 = vendedor paga tudo.
  channelSubsidyPct: number;
  // Teto em R$ do subsídio do canal. null = sem teto. É o que modela o caso
  // da Shopee: percentual alto, mas limitado a um valor absoluto.
  channelSubsidyCapAmount: number | null;
}

export interface ShippingPolicyPayload {
  bands: ShippingBand[];
}

export interface MarketplaceRule {
  id: string;
  marketplaceId: string;
  ruleType: RuleType;
  scopeKey: string;
  payload: unknown;
  version: number;
  status: RuleStatus;
  pinned: boolean;
  sourceType: DataSourceType;
  sourceProviderCode: string;
  sourceFetchedAt: Date;
  sourceEvidenceRef: string | null;
  contentHash: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  validatedById: string | null;
  validatedAt: Date | null;
  tenantId: string | null;
  createdAt: Date;
}

export interface MarketplaceRuleCreateData {
  marketplaceId: string;
  ruleType: RuleType;
  scopeKey: string;
  payload: unknown;
  version: number;
  status: RuleStatus;
  sourceType: DataSourceType;
  sourceProviderCode: string;
  sourceFetchedAt: Date;
  sourceEvidenceRef?: string;
  contentHash: string;
  tenantId?: string;
}
