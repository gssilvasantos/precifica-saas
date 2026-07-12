// Porta de leitura exposta pelo Catalog (dono de CatalogSettings) —
// consumida pelo Pricing Intelligence (PricingDecisionService) para montar
// o piso financeiro de uma decisão de preço.
//
// Fração (0 a <1), não percentual — bate com a fórmula literal do piso
// financeiro: FloorPrice = costPrice / (1 - (taxRate + minProfitMargin)).
// O dado é armazenado como percentual no banco (CatalogSettings.taxRatePct/
// minProfitMarginPct, mesma convenção Xxxpct do resto do schema); a
// conversão (/100) acontece na implementação desta porta
// (FinancialPolicyReaderService), nunca no domínio do Pricing Intelligence.
export interface FinancialPolicy {
  taxRate: number;
  minProfitMargin: number;
}

export interface FinancialPolicyReader {
  getPolicy(tenantId: string): Promise<FinancialPolicy>;
}
