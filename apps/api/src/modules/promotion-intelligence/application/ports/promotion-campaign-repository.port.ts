import { PromotionCampaign, PromotionCampaignCreateData } from '../../domain/promotion-campaign.entity';

export interface PromotionCampaignRepository {
  create(data: PromotionCampaignCreateData): Promise<PromotionCampaign>;
  findById(tenantId: string, id: string): Promise<PromotionCampaign | null>;
  findAllByTenant(tenantId: string): Promise<PromotionCampaign[]>;
}

export const PROMOTION_CAMPAIGN_REPOSITORY = Symbol('PROMOTION_CAMPAIGN_REPOSITORY');
