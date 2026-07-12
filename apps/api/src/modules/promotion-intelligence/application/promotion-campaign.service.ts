import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PROMOTION_CAMPAIGN_REPOSITORY, PromotionCampaignRepository } from './ports/promotion-campaign-repository.port';
import { isValidCampaignWindow, PromotionCampaign } from '../domain/promotion-campaign.entity';

export interface CreatePromotionCampaignInput {
  name: string;
  channelCode: string;
  startAt: Date;
  endAt: Date;
}

// CRUD de referência da campanha — sem lógica de margem (isso é
// PromotionIntelligenceService). Mesmo racional de separação de
// PackagingsService (cadastro) vs. o motor que consome o cadastro.
@Injectable()
export class PromotionCampaignService {
  constructor(@Inject(PROMOTION_CAMPAIGN_REPOSITORY) private readonly campaigns: PromotionCampaignRepository) {}

  // async de propósito (mesmo motivo de todo outro método desta base que
  // valida antes de gravar): lançar dentro de uma função async vira SEMPRE
  // uma promise rejeitada, nunca uma exceção síncrona que escaparia de
  // quem chama esperando um .catch()/.rejects.
  async create(tenantId: string, input: CreatePromotionCampaignInput): Promise<PromotionCampaign> {
    if (!isValidCampaignWindow(input.startAt, input.endAt)) {
      throw new BadRequestException('A data de início da campanha deve ser anterior à data de término.');
    }
    return this.campaigns.create({ tenantId, ...input });
  }

  listByTenant(tenantId: string): Promise<PromotionCampaign[]> {
    return this.campaigns.findAllByTenant(tenantId);
  }

  // "Owned" = já valida que a campanha pertence ao tenant, para nunca deixar
  // um serviço consumidor (PromotionIntelligenceService) acidentalmente
  // avaliar/listar a campanha de outro tenant.
  async getOwned(tenantId: string, campaignId: string): Promise<PromotionCampaign> {
    const campaign = await this.campaigns.findById(tenantId, campaignId);
    if (!campaign) {
      throw new NotFoundException(`Campanha ${campaignId} não encontrada.`);
    }
    return campaign;
  }
}
