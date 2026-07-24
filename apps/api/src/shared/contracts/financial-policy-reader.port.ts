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
// Meta de ROAS do tenant (Ads — Fase 4, sugestão via IA). Mesmo valor de
// DEFAULT_ROAS_HEALTHY_THRESHOLD (marketplace-ads/domain/ads-metrics.ts) de
// propósito — é o mesmo "ROAS saudável" de referência já usado no dashboard
// e nos alertas — mas definido aqui, não importado de lá: catalog nunca
// depende de marketplace-ads (só o inverso), então o número fica duplicado
// intencionalmente entre os dois lugares, documentado explicitamente, em
// vez de criar uma dependência de módulo na direção errada só para
// compartilhar uma constante.
export const DEFAULT_TARGET_ROAS = 3;

export interface FinancialPolicy {
  taxRate: number;
  minProfitMargin: number;
  // Sempre resolvido — nunca null aqui (ao contrário de
  // CatalogSettings.targetRoas, que é nullable no banco). Quem implementa
  // esta porta (FinancialPolicyReaderService) já aplica o fallback para
  // DEFAULT_TARGET_ROAS quando o tenant não configurou a própria meta;
  // nenhum consumidor (ex.: AdsAiOptimizationService) decide esse fallback
  // sozinho.
  targetRoas: number;
}

export interface FinancialPolicyReader {
  getPolicy(tenantId: string): Promise<FinancialPolicy>;
}
