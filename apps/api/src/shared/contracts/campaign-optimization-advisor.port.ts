// Módulo de Ads multicanal — Fase 4 (sugestão via IA, ver
// docs/marketplace-ads-ai-fase4-architecture.md). Porta de leitura pura:
// devolve sugestões, nunca aplica nada — quem decide "escrever de verdade"
// continua sendo só AdsActionDispatcherService (Fase 3), atrás de
// confirmação humana explícita. Esta porta nunca ganha um método de escrita.
//
// actionType restrito a PAUSE_CAMPAIGN no MVP (mesma decisão de escopo da
// Fase 3): o schema já modela o campo como enum fechado, não string livre,
// então ampliar para REDUCE_BID/INCREASE_BUDGET no futuro é só adicionar
// valores ao union — nenhuma mudança estrutural aqui.
export type CampaignOptimizationActionType = 'PAUSE_CAMPAIGN';

export interface CampaignOptimizationCandidate {
  campaignId: string;
  channelCode: string;
  name: string;
  status: string;
  totals: { spend: number; revenueAds: number; clicks: number; impressions: number };
  roas: number | null;
  // CampaignHealthTier (domain/ads-metrics.ts) como string — esta porta é
  // agnóstica de módulo (vive em shared/contracts), nunca importa um tipo de
  // marketplace-ads/domain diretamente.
  tier: string;
  recommendation: string;
}

export interface CampaignOptimizationRequest {
  tenantId: string;
  // Resolvido (nunca null) — FinancialPolicyReader já aplicou o fallback
  // para DEFAULT_TARGET_ROAS antes de chegar aqui.
  targetRoas: number;
  tacos: number | null;
  campaigns: CampaignOptimizationCandidate[];
}

export interface CampaignOptimizationSuggestion {
  campaignId: string;
  actionType: CampaignOptimizationActionType;
  // Precisa citar dado concreto (ver system prompt) — validado
  // superficialmente (comprimento mínimo) por quem consome esta porta,
  // nunca confiado às cegas.
  reasoning: string;
  // 0-1. Nunca usado para decidir aplicar nada sozinho (Safety Lock não
  // enfraquece com confidence alta) — só para o admin priorizar a fila e
  // para auditoria.
  confidenceScore: number;
  // Contexto quantitativo que embasou a sugestão (tendência, delta
  // sugerido...) — só para leitura humana ao lado da sugestão.
  metadata?: Record<string, unknown>;
}

export interface CampaignOptimizationResponse {
  suggestions: CampaignOptimizationSuggestion[];
}

export interface CampaignOptimizationAdvisor {
  suggestActions(request: CampaignOptimizationRequest): Promise<CampaignOptimizationResponse>;
}

export const CAMPAIGN_OPTIMIZATION_ADVISOR = Symbol('CAMPAIGN_OPTIMIZATION_ADVISOR');
