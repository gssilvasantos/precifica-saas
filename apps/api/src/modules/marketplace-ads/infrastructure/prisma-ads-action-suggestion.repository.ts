import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  AdsActionSuggestionRepository,
  AdsActionSuggestionSummary,
  AdsActionStatus,
  AdsActionType,
  AdsActionSource,
  CreatePendingAiFields,
} from '../application/ports/ads-action-suggestion-repository.port';
import { AppDataMode } from '../../../shared/contracts/order-financials-reader.port';

const OPEN_STATUSES: AdsActionStatus[] = ['PENDING', 'CONFIRMED'];

function isDemoFlag(dataMode?: AppDataMode): boolean {
  return dataMode === 'DEMO';
}

@Injectable()
export class PrismaAdsActionSuggestionRepository implements AdsActionSuggestionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(
    tenantId: string,
    campaignId: string,
    actionType: AdsActionType,
    reason: string,
    aiFields?: CreatePendingAiFields,
  ): Promise<string> {
    const record = await this.prisma.adsActionSuggestion.create({
      data: {
        tenantId,
        campaignId,
        actionType,
        reason,
        status: 'PENDING',
        // Sem aiFields = RULE_BASED (o @default(RULE_BASED) do schema cobre
        // isso mesmo se omitido aqui, mas explícito é melhor que implícito
        // quando o valor é condicional).
        source: aiFields?.source ?? 'RULE_BASED',
        confidenceScore: aiFields?.confidenceScore,
        metadata: aiFields?.metadata as any,
      },
    });
    return record.id;
  }

  async findOpenSuggestion(campaignId: string, actionType: AdsActionType): Promise<AdsActionSuggestionSummary | null> {
    const record = await this.prisma.adsActionSuggestion.findFirst({
      where: { campaignId, actionType, status: { in: OPEN_STATUSES } },
      include: { campaign: true },
      orderBy: { suggestedAt: 'desc' },
    });
    return record ? this.toSummary(record) : null;
  }

  async listPending(tenantId: string, dataMode?: AppDataMode): Promise<AdsActionSuggestionSummary[]> {
    // Sem isDemo próprio nesta tabela — filtra via join com a campanha-pai,
    // mesmo racional de sumMetricsByCampaign (PrismaAdsCampaignRepository).
    const records = await this.prisma.adsActionSuggestion.findMany({
      where: { tenantId, status: 'PENDING', campaign: { isDemo: isDemoFlag(dataMode) } },
      include: { campaign: true },
      orderBy: { suggestedAt: 'desc' },
    });
    return records.map((r: any) => this.toSummary(r));
  }

  async findById(tenantId: string, id: string): Promise<AdsActionSuggestionSummary | null> {
    const record = await this.prisma.adsActionSuggestion.findFirst({
      where: { id, tenantId },
      include: { campaign: true },
    });
    return record ? this.toSummary(record) : null;
  }

  async updateStatus(
    id: string,
    status: AdsActionStatus,
    fields?: { resolvedByUserId?: string; failureReason?: string },
  ): Promise<void> {
    const isTerminal = status === 'APPLIED' || status === 'REJECTED' || status === 'FAILED';
    await this.prisma.adsActionSuggestion.update({
      where: { id },
      data: {
        status,
        resolvedByUserId: fields?.resolvedByUserId,
        failureReason: fields?.failureReason,
        // resolvedAt só é preenchido no estado TERMINAL (APPLIED/REJECTED/
        // FAILED) — CONFIRMED é transitório dentro da mesma chamada, ainda
        // não é "resolvido" de fato até o provider responder.
        ...(isTerminal ? { resolvedAt: new Date() } : {}),
      },
    });
  }

  // Demo Mode — remove toda sugestão cuja campanha-pai é isDemo=true. Deve
  // ser chamado ANTES de AdsCampaignRepository.deleteDemoCampaigns (a FK
  // campaignId exige isso) — AdsAuditSeederService.clear() garante a ordem.
  async deleteDemoSuggestions(tenantId: string): Promise<number> {
    const { count } = await this.prisma.adsActionSuggestion.deleteMany({
      where: { tenantId, campaign: { isDemo: true } },
    });
    return count;
  }

  private toSummary(record: {
    id: string;
    tenantId: string;
    campaignId: string;
    actionType: string;
    status: string;
    reason: string;
    suggestedAt: Date;
    resolvedAt: Date | null;
    resolvedByUserId: string | null;
    failureReason: string | null;
    source: string;
    confidenceScore: number | null;
    metadata: unknown;
    campaign: { externalCampaignId: string; name: string; channelCode: string };
  }): AdsActionSuggestionSummary {
    return {
      id: record.id,
      tenantId: record.tenantId,
      campaignId: record.campaignId,
      externalCampaignId: record.campaign.externalCampaignId,
      campaignName: record.campaign.name,
      channelCode: record.campaign.channelCode,
      actionType: record.actionType as AdsActionType,
      status: record.status as AdsActionStatus,
      reason: record.reason,
      suggestedAt: record.suggestedAt,
      resolvedAt: record.resolvedAt,
      resolvedByUserId: record.resolvedByUserId,
      failureReason: record.failureReason,
      source: record.source as AdsActionSource,
      confidenceScore: record.confidenceScore,
      metadata: (record.metadata as Record<string, unknown> | null) ?? null,
    };
  }
}
