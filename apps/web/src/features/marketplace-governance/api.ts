import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/marketplace-intelligence/domain/*.entity.ts
// — mesmo racional de duplicação intencional do resto do frontend.
export type RuleType = 'FEE_RULE' | 'SHIPPING_POLICY' | 'CATEGORY_TAXONOMY';
export type DataSourceType = 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL';
export type RuleStatus = 'PENDENTE_VALIDACAO' | 'VALIDADA' | 'DESATUALIZADA' | 'OBSOLETA';

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
  sourceFetchedAt: string;
  sourceEvidenceRef: string | null;
  contentHash: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  validatedById: string | null;
  validatedAt: string | null;
  tenantId: string | null;
  createdAt: string;
}

export type ChangeResolution = 'AUTO_APPLIED' | 'PENDING_REVIEW' | 'REJECTED' | 'APPLIED_MANUALLY';

export interface MarketplaceChangeEvent {
  id: string;
  marketplaceId: string;
  ruleType: string;
  scopeKey: string;
  previousRuleId: string | null;
  newRuleId: string;
  changeSummary: string;
  detectedByProvider: string;
  detectedAt: string;
  resolutionStatus: ChangeResolution;
  reviewedById: string | null;
  reviewedAt: string | null;
}

export interface MarketplaceProviderDescriptor {
  code: string;
  marketplaceCode: string;
  sourceType: DataSourceType;
  capabilities: string[];
}

export async function fetchPendingRules(marketplaceCode?: string): Promise<MarketplaceRule[]> {
  const { data } = await apiClient.get<MarketplaceRule[]>('/marketplace-intelligence/rules/pending', {
    params: marketplaceCode ? { marketplaceCode } : undefined,
  });
  return data;
}

export async function approveRule(id: string): Promise<MarketplaceRule> {
  const { data } = await apiClient.post<MarketplaceRule>(`/marketplace-intelligence/rules/${id}/approve`, {});
  return data;
}

export async function rejectRule(id: string): Promise<MarketplaceRule> {
  const { data } = await apiClient.post<MarketplaceRule>(`/marketplace-intelligence/rules/${id}/reject`, {});
  return data;
}

export async function pinRule(id: string): Promise<MarketplaceRule> {
  const { data } = await apiClient.put<MarketplaceRule>(`/marketplace-intelligence/rules/${id}/pin`, {});
  return data;
}

export async function unpinRule(id: string): Promise<MarketplaceRule> {
  const { data } = await apiClient.put<MarketplaceRule>(`/marketplace-intelligence/rules/${id}/unpin`, {});
  return data;
}

export async function createManualRule(input: {
  marketplaceCode: string;
  ruleType: RuleType;
  scopeKey: string;
  payload: Record<string, unknown>;
  tenantId?: string;
}): Promise<MarketplaceRule> {
  const { data } = await apiClient.post<MarketplaceRule>('/marketplace-intelligence/rules', input);
  return data;
}

export async function fetchChangeEvents(marketplaceId?: string, limit?: number): Promise<MarketplaceChangeEvent[]> {
  const { data } = await apiClient.get<MarketplaceChangeEvent[]>('/marketplace-intelligence/change-events', {
    params: { marketplaceId, limit },
  });
  return data;
}

export async function fetchMarketplaceProviders(): Promise<MarketplaceProviderDescriptor[]> {
  const { data } = await apiClient.get<MarketplaceProviderDescriptor[]>('/marketplace-intelligence/providers');
  return data;
}

export async function triggerProviderSync(providerCode: string): Promise<{ triggered: boolean; providerCode: string }> {
  const { data } = await apiClient.post<{ triggered: boolean; providerCode: string }>(`/marketplace-intelligence/providers/${providerCode}/sync`, {});
  return data;
}
