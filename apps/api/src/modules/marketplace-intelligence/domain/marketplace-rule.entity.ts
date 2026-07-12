export type RuleType = 'FEE_RULE' | 'SHIPPING_POLICY' | 'CATEGORY_TAXONOMY';
export type DataSourceType = 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL';
export type RuleStatus = 'PENDENTE_VALIDACAO' | 'VALIDADA' | 'DESATUALIZADA' | 'OBSOLETA';

export interface FeeRulePayload {
  commissionPct: number;
  fixedFeeAmount: number;
  referencePrice?: number;
  listingTypeId?: string;
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
