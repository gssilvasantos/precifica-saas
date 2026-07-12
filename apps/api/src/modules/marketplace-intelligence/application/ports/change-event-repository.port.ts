import { ChangeResolution, MarketplaceChangeEvent } from '../../domain/change-event.entity';

export interface ChangeEventCreateData {
  marketplaceId: string;
  ruleType: string;
  scopeKey: string;
  previousRuleId?: string;
  newRuleId: string;
  changeSummary: string;
  detectedByProvider: string;
  resolutionStatus: ChangeResolution;
}

export interface ChangeEventRepository {
  create(data: ChangeEventCreateData): Promise<MarketplaceChangeEvent>;
  findRecent(marketplaceId?: string, limit?: number): Promise<MarketplaceChangeEvent[]>;
}

export const CHANGE_EVENT_REPOSITORY = Symbol('CHANGE_EVENT_REPOSITORY');
