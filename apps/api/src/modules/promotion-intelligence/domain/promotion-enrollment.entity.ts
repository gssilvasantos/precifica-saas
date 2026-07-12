import { MarginStatus } from './margin-calculator';

export type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'BLOCKED';

// Snapshot do cálculo no momento da adesão — mesmo racional de
// OrderItem.costPriceUsed (Etapa 19): nunca recalculado silenciosamente
// depois. Ver comentário completo em prisma/schema.prisma,
// model PromotionEnrollment.
export interface PromotionEnrollment {
  id: string;
  tenantId: string;
  campaignId: string;
  skuCode: string;
  promotionalPrice: number;

  costPriceUsed: number;
  feesAmount: number;
  taxAmount: number;
  logisticsCost: number;
  netMarginAmount: number;
  netMarginPct: number;

  marginStatus: MarginStatus;
  enrollmentStatus: EnrollmentStatus;
  blockedReason: string | null;
  feeRuleFound: boolean;
  computedAt: Date;
}

export interface PromotionEnrollmentCreateData {
  tenantId: string;
  campaignId: string;
  skuCode: string;
  promotionalPrice: number;
  costPriceUsed: number;
  feesAmount: number;
  taxAmount: number;
  logisticsCost: number;
  netMarginAmount: number;
  netMarginPct: number;
  marginStatus: MarginStatus;
  enrollmentStatus: EnrollmentStatus;
  blockedReason: string | null;
  feeRuleFound: boolean;
}
