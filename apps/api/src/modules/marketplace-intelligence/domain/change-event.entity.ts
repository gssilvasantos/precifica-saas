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
  detectedAt: Date;
  resolutionStatus: ChangeResolution;
  reviewedById: string | null;
  reviewedAt: Date | null;
}
