// Porta consumida pelo futuro Pricing Intelligence — é a ÚNICA coisa que o
// motor de preço vai conhecer do Marketplace Intelligence. Não importa
// MarketplaceProvider, não importa nenhum model Prisma deste módulo.
export interface ResolvedFeeRule {
  commissionPct: number;
  fixedFeeAmount: number;
  ruleId: string; // auditoria: qual MarketplaceRule.id gerou este resultado
  ruleVersion: number;
}

export interface FeeRuleResolver {
  resolveFeeRule(params: {
    marketplaceCode: string;
    categoryCode: string;
    tenantId: string;
    atDate?: Date; // default: agora
  }): Promise<ResolvedFeeRule | null>; // null = nenhuma regra validada disponível ainda
}
