import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/promotion-intelligence/domain/*.ts +
// application/promotion-intelligence.service.ts — mesma disciplina de
// duplicação intencional do resto do frontend.
export type PromotionCampaignStatus = 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface PromotionCampaign {
  id: string;
  tenantId: string;
  name: string;
  channelCode: string;
  startAt: string;
  endAt: string;
  status: PromotionCampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromotionCampaignInput {
  name: string;
  channelCode: string;
  startAt: string; // ISO
  endAt: string; // ISO
}

export type MarginStatus = 'VERDE' | 'VERMELHO';

// Semáforo de Margem — pré-visualização de leitura, não grava nada (ver
// PromotionIntelligenceService.computeMargin). feeRuleFound=false é um
// alerta honesto: sem regra de taxa cadastrada, a margem calculada assumiu
// taxa zero e pode estar otimista.
export interface MarginPreview {
  skuCode: string;
  channelCode: string;
  promotionalPrice: number;
  costPriceUsed: number;
  feesAmount: number;
  taxAmount: number;
  logisticsCost: number;
  netMarginAmount: number;
  netMarginPct: number;
  marginStatus: MarginStatus;
  feeRuleFound: boolean;
}

export type EnrollmentStatus = 'PENDING' | 'APPROVED' | 'BLOCKED';

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
  computedAt: string;
}

export async function fetchPromotionCampaigns(): Promise<PromotionCampaign[]> {
  const { data } = await apiClient.get<PromotionCampaign[]>('/promotion-intelligence/campaigns');
  return data;
}

export async function fetchPromotionCampaign(id: string): Promise<PromotionCampaign> {
  const { data } = await apiClient.get<PromotionCampaign>(`/promotion-intelligence/campaigns/${id}`);
  return data;
}

export async function createPromotionCampaign(input: CreatePromotionCampaignInput): Promise<PromotionCampaign> {
  const { data } = await apiClient.post<PromotionCampaign>('/promotion-intelligence/campaigns', input);
  return data;
}

export async function previewCampaignMargin(
  campaignId: string,
  skuCode: string,
  promotionalPrice: number,
): Promise<MarginPreview> {
  const { data } = await apiClient.get<MarginPreview>(`/promotion-intelligence/campaigns/${campaignId}/margin-preview`, {
    params: { skuCode, promotionalPrice },
  });
  return data;
}

// Sempre responde 201 — o bloqueio por margem negativa (enrollmentStatus
// BLOCKED) é um dado de negócio no corpo, nunca um erro HTTP (ver
// PromotionIntelligenceService.validateEnrollment).
export async function enrollSkuInCampaign(
  campaignId: string,
  skuCode: string,
  promotionalPrice: number,
): Promise<PromotionEnrollment> {
  const { data } = await apiClient.post<PromotionEnrollment>(`/promotion-intelligence/campaigns/${campaignId}/enrollments`, {
    skuCode,
    promotionalPrice,
  });
  return data;
}

export async function fetchCampaignEnrollments(campaignId: string): Promise<PromotionEnrollment[]> {
  const { data } = await apiClient.get<PromotionEnrollment[]>(`/promotion-intelligence/campaigns/${campaignId}/enrollments`);
  return data;
}
