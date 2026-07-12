import { PromotionEnrollment, PromotionEnrollmentCreateData } from '../../domain/promotion-enrollment.entity';

export interface PromotionEnrollmentRepository {
  // Upsert por (campaignId, skuCode) — reavaliar a mesma adesão (ex.: custo
  // mudou, o usuário quer conferir de novo) SOBRESCREVE o snapshot anterior,
  // nunca acumula histórico duplicado para o mesmo par campanha/SKU.
  create(data: PromotionEnrollmentCreateData): Promise<PromotionEnrollment>;
  findByCampaignAndSku(tenantId: string, campaignId: string, skuCode: string): Promise<PromotionEnrollment | null>;
  findAllByCampaign(tenantId: string, campaignId: string): Promise<PromotionEnrollment[]>;
}

export const PROMOTION_ENROLLMENT_REPOSITORY = Symbol('PROMOTION_ENROLLMENT_REPOSITORY');
