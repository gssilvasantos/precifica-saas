// Porta exposta pelo Marketplace Intelligence — o que ESTE vendedor
// contratou/é em cada canal. Deliberadamente separada de FeeRuleResolver e
// ShippingPolicyResolver, que descrevem como o CANAL cobra de todo mundo.
//
// A distinção não é acadêmica: a tabela de comissão da Amazon é a mesma
// para todos os vendedores, mas quem assina o "Plano de vendas
// profissional" não paga a tarifa por item; a política de frete do Mercado
// Livre é uma só, mas o desconto varia por reputação da conta. Misturar as
// duas coisas obrigaria a criar uma regra versionada por tenant só para
// registrar uma configuração de cadastro.
//
// Ver docs/marketplace-fee-model-architecture.md, §2.0.
export interface ChannelSellerProfile {
  channelCode: string;
  // Amazon — "Plano de vendas profissional" (R$19/mês). Ativo = a tarifa
  // por item do plano Individual (R$2) não é cobrada. Inativo = é.
  professionalPlanActive: boolean;
  // Mercado Livre — desconto no frete por reputação, fração (0 a 1). Até
  // 0.7 (70%) para reputação verde-escuro.
  freightDiscountPct: number;
}

// Perfil neutro: nada contratado, nenhum desconto. É o que vale quando o
// vendedor ainda não configurou o canal — sempre o lado CONSERVADOR (paga
// a tarifa por item, paga o frete cheio), nunca o otimista. Um preço
// calculado a menor por assumir um benefício inexistente vira prejuízo
// silencioso; a menos, no máximo, vira uma venda a mais que não aconteceu.
export const NEUTRAL_CHANNEL_SELLER_PROFILE: Omit<ChannelSellerProfile, 'channelCode'> = {
  professionalPlanActive: false,
  freightDiscountPct: 0,
};

export interface ChannelSellerProfileReader {
  getProfile(tenantId: string, channelCode: string): Promise<ChannelSellerProfile>;
}
