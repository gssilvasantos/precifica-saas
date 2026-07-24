import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  AdsCampaignMetricTotals,
  AdsCampaignRepository,
  AdsCampaignSummary,
  SeedDemoCampaignData,
  SeedDemoMetricData,
} from '../application/ports/ads-campaign-repository.port';
import { RawAdsCampaignCandidate, RawAdsMetricCandidate } from '../../../shared/contracts/marketplace-provider.contract';
import { CampaignHealthTier } from '../domain/ads-metrics';
import { AppDataMode } from '../../../shared/contracts/order-financials-reader.port';

// Traduz o dataMode ('REAL' | 'DEMO' | ausente) para o valor de isDemo usado
// no WHERE de toda query — mesmo helper (mesmo nome, mesma assinatura) já
// usado em PrismaOrderRepository. Ausente = 'REAL' (fail-safe).
function isDemoFlag(dataMode?: AppDataMode): boolean {
  return dataMode === 'DEMO';
}

@Injectable()
export class PrismaAdsCampaignRepository implements AdsCampaignRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCampaign(tenantId: string, channelCode: string, data: RawAdsCampaignCandidate): Promise<string> {
    const record = await this.prisma.adsCampaign.upsert({
      where: {
        tenantId_channelCode_externalCampaignId: {
          tenantId,
          channelCode,
          externalCampaignId: data.externalCampaignId,
        },
      },
      create: {
        tenantId,
        channelCode,
        externalCampaignId: data.externalCampaignId,
        name: data.name,
        status: data.status,
        dailyBudget: data.dailyBudget,
        lastSyncedAt: new Date(),
      },
      update: {
        name: data.name,
        status: data.status,
        dailyBudget: data.dailyBudget,
        lastSyncedAt: new Date(),
      },
    });
    return record.id;
  }

  async upsertMetricSnapshot(tenantId: string, campaignId: string, data: RawAdsMetricCandidate): Promise<void> {
    await this.prisma.adsMetricSnapshot.upsert({
      where: {
        campaignId_periodDate: {
          campaignId,
          periodDate: data.periodDate,
        },
      },
      create: {
        campaignId,
        tenantId,
        periodDate: data.periodDate,
        spend: data.spend,
        revenueAds: data.revenueAds,
        clicks: data.clicks,
        impressions: data.impressions,
      },
      update: {
        spend: data.spend,
        revenueAds: data.revenueAds,
        clicks: data.clicks,
        impressions: data.impressions,
        syncedAt: new Date(),
      },
    });
  }

  async listCampaigns(tenantId: string, channelCode?: string, dataMode?: AppDataMode): Promise<AdsCampaignSummary[]> {
    const records = await this.prisma.adsCampaign.findMany({
      where: { tenantId, isDemo: isDemoFlag(dataMode), ...(channelCode ? { channelCode } : {}) },
      orderBy: { name: 'asc' },
    });
    return records.map((r) => ({
      id: r.id,
      channelCode: r.channelCode,
      externalCampaignId: r.externalCampaignId,
      name: r.name,
      status: r.status,
      dailyBudget: r.dailyBudget !== null ? Number(r.dailyBudget) : null,
      lastSyncedAt: r.lastSyncedAt,
      lastAlertedTier: (r.lastAlertedTier as CampaignHealthTier | null) ?? null,
      lastAlertedAt: r.lastAlertedAt,
    }));
  }

  // Fase 2 (alertas inteligentes) — único gravador do estado de alerta de
  // uma campanha. tier=null/alertedAt=null representa RESET (recuperou ou
  // nunca alertou); tier preenchido representa o último ALERT emitido.
  async updateAlertState(campaignId: string, tier: CampaignHealthTier | null, alertedAt: Date | null): Promise<void> {
    await this.prisma.adsCampaign.update({
      where: { id: campaignId },
      data: { lastAlertedTier: tier, lastAlertedAt: alertedAt },
    });
  }

  // Soma por campanha dentro do período — usada pelo AdsInsightsService para
  // montar o dashboard (ROAS por campanha + TACOS agregado). Sem paginação
  // de propósito, mesmo racional de OrderRepository.findAllForPeriod: serve
  // um relatório agregado de um período, não uma tela paginada.
  async sumMetricsByCampaign(tenantId: string, dateFrom: Date, dateTo: Date, dataMode?: AppDataMode): Promise<AdsCampaignMetricTotals[]> {
    // AdsMetricSnapshot não tem isDemo próprio — filtra via join com a
    // campanha-pai (campaign.isDemo), mesmo racional de OrderItem/Order.
    // Prisma resolve isso como um WHERE com join, mesmo dentro de groupBy.
    const groups = await this.prisma.adsMetricSnapshot.groupBy({
      by: ['campaignId'],
      where: { tenantId, periodDate: { gte: dateFrom, lte: dateTo }, campaign: { isDemo: isDemoFlag(dataMode) } },
      _sum: { spend: true, revenueAds: true, clicks: true, impressions: true },
    });
    return groups.map((g) => ({
      campaignId: g.campaignId,
      spend: Number(g._sum.spend ?? 0),
      revenueAds: Number(g._sum.revenueAds ?? 0),
      clicks: g._sum.clicks ?? 0,
      impressions: g._sum.impressions ?? 0,
    }));
  }

  // --- Demo Mode (AdsAuditSeederService) ---

  async seedDemoCampaign(tenantId: string, data: SeedDemoCampaignData): Promise<string> {
    const record = await this.prisma.adsCampaign.upsert({
      where: {
        tenantId_channelCode_externalCampaignId: {
          tenantId,
          channelCode: data.channelCode,
          externalCampaignId: data.externalCampaignId,
        },
      },
      create: {
        tenantId,
        channelCode: data.channelCode,
        externalCampaignId: data.externalCampaignId,
        name: data.name,
        status: data.status,
        dailyBudget: data.dailyBudget,
        lastSyncedAt: new Date(),
        isDemo: true,
      },
      update: {
        name: data.name,
        status: data.status,
        dailyBudget: data.dailyBudget,
        lastSyncedAt: new Date(),
      },
    });
    return record.id;
  }

  async seedDemoMetricSnapshot(tenantId: string, campaignId: string, data: SeedDemoMetricData): Promise<void> {
    await this.prisma.adsMetricSnapshot.upsert({
      where: { campaignId_periodDate: { campaignId, periodDate: data.periodDate } },
      create: {
        campaignId,
        tenantId,
        periodDate: data.periodDate,
        spend: data.spend,
        revenueAds: data.revenueAds,
        clicks: data.clicks,
        impressions: data.impressions,
      },
      update: {
        spend: data.spend,
        revenueAds: data.revenueAds,
        clicks: data.clicks,
        impressions: data.impressions,
        syncedAt: new Date(),
      },
    });
  }

  // Ordem importa pela FK: sugestões demo são removidas à parte, ANTES desta
  // chamada, por AdsAuditSeederService.clear() (via
  // AdsActionSuggestionRepository.deleteDemoSuggestions) — aqui só falta
  // limpar as métricas (sem porta própria, FK direta) e as campanhas.
  async deleteDemoCampaigns(tenantId: string): Promise<number> {
    const demoCampaigns = await this.prisma.adsCampaign.findMany({
      where: { tenantId, isDemo: true },
      select: { id: true },
    });
    const ids = demoCampaigns.map((c) => c.id);
    if (ids.length === 0) return 0;

    await this.prisma.adsMetricSnapshot.deleteMany({ where: { campaignId: { in: ids } } });
    const { count } = await this.prisma.adsCampaign.deleteMany({ where: { tenantId, isDemo: true } });
    return count;
  }

  async countDemoCampaigns(tenantId: string): Promise<number> {
    return this.prisma.adsCampaign.count({ where: { tenantId, isDemo: true } });
  }
}
