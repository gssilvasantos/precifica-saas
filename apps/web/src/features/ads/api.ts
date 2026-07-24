import { apiClient } from '../../lib/api-client';
import type { AppDataMode } from '../app-mode/api';

// Espelha 1:1 apps/api/src/modules/marketplace-ads/application/ads-metrics.ts
// + ads-insights.service.ts + ads-action-suggestion-repository.port.ts —
// mesmo racional de duplicação intencional do resto do frontend (o
// frontend nunca importa tipo do backend, só replica o formato do JSON).
export type CampaignHealthTier = 'ESTRELA' | 'PONTO_DE_ATENCAO' | 'CUSTO_PERDIDO' | 'SEM_DADOS';
export type AdsActionStatus = 'PENDING' | 'CONFIRMED' | 'APPLIED' | 'REJECTED' | 'FAILED';
export type AdsActionSource = 'RULE_BASED' | 'AI';

export interface CampaignMetricsTotals {
  spend: number;
  revenueAds: number;
  clicks: number;
  impressions: number;
}

export interface AdsCampaignInsight {
  campaignId: string;
  channelCode: string;
  externalCampaignId: string;
  name: string;
  status: string;
  totals: CampaignMetricsTotals;
  roas: number | null;
  tier: CampaignHealthTier;
  recommendation: string;
}

export interface AdsDashboard {
  periodFrom: string;
  periodTo: string;
  campaigns: AdsCampaignInsight[];
  totals: CampaignMetricsTotals;
  totalTenantRevenue: number;
  tacos: number | null;
}

// Sugestão de ação (Fase 2/3/4 — Safety Lock) — reason/confidenceScore/
// metadata são o que o briefing pediu em destaque: reason é o `reasoning`
// (nome interno do dado que a IA devolve; o backend persiste como `reason`
// no banco, ver AdsActionSuggestion.reason no schema.prisma).
export interface AdsActionSuggestion {
  id: string;
  tenantId: string;
  campaignId: string;
  externalCampaignId: string;
  campaignName: string;
  channelCode: string;
  actionType: 'PAUSE_CAMPAIGN';
  status: AdsActionStatus;
  reason: string;
  suggestedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  failureReason: string | null;
  source: AdsActionSource;
  confidenceScore: number | null;
  metadata: Record<string, unknown> | null;
}

export async function fetchAdsDashboard(mode?: AppDataMode, dateFrom?: string, dateTo?: string): Promise<AdsDashboard> {
  const { data } = await apiClient.get<AdsDashboard>('/marketplace-ads/dashboard', {
    params: { mode, dateFrom, dateTo },
  });
  return data;
}

export async function fetchPendingAdsActions(mode?: AppDataMode): Promise<AdsActionSuggestion[]> {
  const { data } = await apiClient.get<AdsActionSuggestion[]>('/marketplace-ads/actions/pending', {
    params: { mode },
  });
  return data;
}

// Confirmar/rejeitar são sempre ADMIN-only no backend (Safety Lock) — o
// backend já recusa 403 para quem não é Admin; o frontend só chama, a
// tela decide se mostra os botões via useAuth()/useAppMode().canToggle
// (mesmo papel que já controla o Audit Mode).
export async function confirmAdsAction(id: string): Promise<AdsActionSuggestion> {
  const { data } = await apiClient.post<AdsActionSuggestion>(`/marketplace-ads/actions/${id}/confirm`);
  return data;
}

export async function rejectAdsAction(id: string): Promise<AdsActionSuggestion> {
  const { data } = await apiClient.post<AdsActionSuggestion>(`/marketplace-ads/actions/${id}/reject`);
  return data;
}

// --- Modo de Demonstração / Audit Mode (escopo Ads) ---
// Espelha features/app-mode/api.ts (Orders), endpoint dedicado do módulo de
// Ads — ver AdsAuditModeController.
export interface AdsAuditStatus {
  totalDemoCampaigns: number;
}

export interface AdsAuditSeedResult {
  seededCampaigns: number;
  seededSuggestions: number;
  externalCampaignIds: string[];
}

export interface AdsAuditClearResult {
  removedCampaigns: number;
  removedSuggestions: number;
}

export async function fetchAdsAuditStatus(): Promise<AdsAuditStatus> {
  const { data } = await apiClient.get<AdsAuditStatus>('/marketplace-ads/audit-mode/status');
  return data;
}

export async function seedAdsAuditData(): Promise<AdsAuditSeedResult> {
  const { data } = await apiClient.post<AdsAuditSeedResult>('/marketplace-ads/audit-mode/seed');
  return data;
}

export async function clearAdsAuditData(): Promise<AdsAuditClearResult> {
  const { data } = await apiClient.post<AdsAuditClearResult>('/marketplace-ads/audit-mode/clear');
  return data;
}
