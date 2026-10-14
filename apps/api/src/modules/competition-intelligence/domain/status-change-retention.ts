// Política de retenção de CompetitiveOpportunityStatusChange — item que
// ficou pendente na entrega original (14/10/2026, ver ADR-0004 e seção 11
// de docs/competition-intelligence-architecture.md). Regra pura: calcula o
// corte de data, sem I/O — a decisão de QUANTOS dias manter é testável
// isoladamente, igual a VIDEO_RETENTION_DAYS em logistics-fulfillment.
//
// Por que 365 dias (não os 30 usados para vídeo de conferência): o
// propósito desta tabela é permitir análise de tendência de buy box
// (sazonalidade, "perdemos esse SKU todo dezembro?") — 30 dias descartaria
// exatamente o dado que motivou a feature. Cresce no máximo uma linha por
// TRANSIÇÃO real de status, não por coleta (ver status-change-recorder.ts),
// então o volume é limitado mesmo numa janela de um ano — diferente de
// CompetitorOfferSnapshot, que cresce por coleta e já tem retenção
// indefinida como dívida própria, registrada e fora do escopo desta regra.
export const BUY_BOX_STATUS_CHANGE_RETENTION_DAYS = 365;

export function buyBoxStatusChangeRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - BUY_BOX_STATUS_CHANGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
