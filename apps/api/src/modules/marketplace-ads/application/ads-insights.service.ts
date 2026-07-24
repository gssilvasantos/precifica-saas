import { Inject, Injectable } from '@nestjs/common';
import { ADS_CAMPAIGN_REPOSITORY, AdsCampaignRepository, AdsCampaignSummary } from './ports/ads-campaign-repository.port';
import { ORDER_FINANCIALS_READER } from '../../../shared/contracts/tokens';
import { AppDataMode, OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { calculateRoas, calculateTacos, classifyCampaignHealth, CampaignMetricsTotals } from '../domain/ads-metrics';

export interface AdsCampaignInsight {
  campaignId: string;
  channelCode: string;
  externalCampaignId: string;
  name: string;
  status: string;
  totals: CampaignMetricsTotals;
  roas: number | null;
  tier: string;
  recommendation: string;
}

export interface AdsDashboard {
  periodFrom: Date;
  periodTo: Date;
  campaigns: AdsCampaignInsight[];
  totals: CampaignMetricsTotals;
  totalTenantRevenue: number;
  tacos: number | null;
}

const ZERO_TOTALS: CampaignMetricsTotals = { spend: 0, revenueAds: 0, clicks: 0, impressions: 0 };

// Read-side do Módulo de Ads (Fase 1) — junta AdsCampaign/AdsMetricSnapshot
// (persistidos pelo AdsSyncOrchestrator) com a receita TOTAL do tenant
// (ORDER_FINANCIALS_READER, MESMA porta que alimenta o DRE) para calcular o
// TACOS agregado. Nunca importa OrdersService/PrismaService diretamente —
// só a porta, mesmo padrão de FinancialOrchestrator.
@Injectable()
export class AdsInsightsService {
  constructor(
    @Inject(ADS_CAMPAIGN_REPOSITORY) private readonly campaigns: AdsCampaignRepository,
    @Inject(ORDER_FINANCIALS_READER) private readonly orderFinancials: OrderFinancialsReader,
  ) {}

  // dataMode ausente = 'REAL' (fail-safe, mesmo racional de todo o resto da
  // plataforma) — thread até as 3 fontes (campanhas, métricas e receita
  // total do tenant) para que o dashboard em Demo Mode nunca misture um
  // canal real com o outro fictício, nem no TACOS agregado.
  async getDashboard(tenantId: string, dateFrom: Date, dateTo: Date, dataMode?: AppDataMode): Promise<AdsDashboard> {
    const [campaignSummaries, metricTotals, orderLines] = await Promise.all([
      this.campaigns.listCampaigns(tenantId, undefined, dataMode),
      this.campaigns.sumMetricsByCampaign(tenantId, dateFrom, dateTo, dataMode),
      this.orderFinancials.listForPeriod(tenantId, dateFrom, dateTo, dataMode),
    ]);

    const totalsByCampaignId = new Map(metricTotals.map((m) => [m.campaignId, m]));

    const campaignInsights: AdsCampaignInsight[] = campaignSummaries.map((c: AdsCampaignSummary) => {
      const raw = totalsByCampaignId.get(c.id);
      const totals: CampaignMetricsTotals = raw
        ? { spend: raw.spend, revenueAds: raw.revenueAds, clicks: raw.clicks, impressions: raw.impressions }
        : ZERO_TOTALS;
      const roas = calculateRoas(totals);
      const health = classifyCampaignHealth(totals);

      return {
        campaignId: c.id,
        channelCode: c.channelCode,
        externalCampaignId: c.externalCampaignId,
        name: c.name,
        status: c.status,
        totals,
        roas,
        tier: health.tier,
        recommendation: health.recommendation,
      };
    });

    const aggregateTotals: CampaignMetricsTotals = campaignInsights.reduce(
      (acc, c) => ({
        spend: acc.spend + c.totals.spend,
        revenueAds: acc.revenueAds + c.totals.revenueAds,
        clicks: acc.clicks + c.totals.clicks,
        impressions: acc.impressions + c.totals.impressions,
      }),
      { ...ZERO_TOTALS },
    );

    // totalTenantRevenue = receita TOTAL do período (ads + orgânica) — a
    // MESMA fonte que o DRE usa (totalAmount de cada pedido), nunca uma
    // segunda consulta de "quanto foi vendido organicamente". Ver
    // domain/ads-metrics.ts, calculateTacos, para o racional completo.
    const totalTenantRevenue = orderLines.reduce((sum, line) => sum + line.totalAmount, 0);
    const tacos = calculateTacos(aggregateTotals.spend, totalTenantRevenue);

    return {
      periodFrom: dateFrom,
      periodTo: dateTo,
      campaigns: campaignInsights,
      totals: aggregateTotals,
      totalTenantRevenue,
      tacos,
    };
  }
}
