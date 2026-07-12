import { MarketplaceRule, MarketplaceRuleCreateData, RuleStatus } from '../../domain/marketplace-rule.entity';

export interface MarketplaceRuleRepository {
  create(data: MarketplaceRuleCreateData): Promise<MarketplaceRule>;
  findLatestValidated(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string | null,
  ): Promise<MarketplaceRule | null>;
  findLatestVersion(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string | null,
  ): Promise<MarketplaceRule | null>;
  findByStatus(status: RuleStatus, marketplaceId?: string): Promise<MarketplaceRule[]>;
  findById(id: string): Promise<MarketplaceRule | null>;
  updateStatus(
    id: string,
    status: RuleStatus,
    validatedById?: string,
  ): Promise<MarketplaceRule>;
  setPinned(id: string, pinned: boolean): Promise<MarketplaceRule>;
  markEffectiveToNow(id: string): Promise<void>;
  // Resolução usada pelo FeeRuleResolver: última regra VALIDADA, vigente na
  // data pedida, respeitando override de tenant sobre a regra global.
  resolveEffective(
    marketplaceId: string,
    ruleType: string,
    scopeKey: string,
    tenantId: string,
    atDate: Date,
  ): Promise<MarketplaceRule | null>;
}

export const MARKETPLACE_RULE_REPOSITORY = Symbol('MARKETPLACE_RULE_REPOSITORY');
