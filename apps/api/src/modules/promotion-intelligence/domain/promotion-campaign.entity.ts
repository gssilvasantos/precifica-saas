export type PromotionCampaignStatus = 'DRAFT' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

export interface PromotionCampaign {
  id: string;
  tenantId: string;
  name: string;
  channelCode: string;
  startAt: Date;
  endAt: Date;
  status: PromotionCampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromotionCampaignCreateData {
  tenantId: string;
  name: string;
  channelCode: string;
  startAt: Date;
  endAt: Date;
}

// Validação pura de datas — startAt precisa ser antes de endAt. Não valida
// "não pode ser no passado": campanhas cadastradas com atraso (ex.: já
// começou, só estamos registrando agora) são um caso real, não um erro.
export function isValidCampaignWindow(startAt: Date, endAt: Date): boolean {
  return startAt.getTime() < endAt.getTime();
}
