import { AdsInsightsService } from './ads-insights.service';
import { AdsCampaignRepository } from './ports/ads-campaign-repository.port';
import { OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';

describe('AdsInsightsService', () => {
  function buildService() {
    const campaigns = {
      upsertCampaign: jest.fn(),
      upsertMetricSnapshot: jest.fn(),
      listCampaigns: jest.fn(),
      sumMetricsByCampaign: jest.fn(),
    } as unknown as jest.Mocked<AdsCampaignRepository>;
    const orderFinancials = { listForPeriod: jest.fn(), findItemsForOrders: jest.fn() } as unknown as jest.Mocked<OrderFinancialsReader>;
    const service = new AdsInsightsService(campaigns, orderFinancials);
    return { service, campaigns, orderFinancials };
  }

  const dateFrom = new Date('2026-07-01');
  const dateTo = new Date('2026-07-31');

  it('junta campanha + métricas + receita total do tenant, calculando ROAS por campanha e TACOS agregado', async () => {
    const { service, campaigns, orderFinancials } = buildService();
    campaigns.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        channelCode: 'MERCADO_LIVRE',
        externalCampaignId: 'ext-1',
        name: 'Campanha 1',
        status: 'ACTIVE',
        dailyBudget: 20,
        lastSyncedAt: new Date(),
        lastAlertedTier: null,
        lastAlertedAt: null,
      },
    ]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 100, revenueAds: 500, clicks: 40, impressions: 1000 }]);
    orderFinancials.listForPeriod.mockResolvedValue([
      { orderId: 'o1', externalOrderId: 'e1', channelCode: 'MERCADO_LIVRE', status: 'FATURADO', orderedAt: new Date(), totalAmount: 5000, shippingAmount: 0, discountAmount: 0, feeAmount: 0, items: [] },
    ]);

    const dashboard = await service.getDashboard('tenant-1', dateFrom, dateTo);

    expect(dashboard.campaigns).toHaveLength(1);
    expect(dashboard.campaigns[0].roas).toBe(5); // 500/100
    expect(dashboard.campaigns[0].tier).toBe('ESTRELA'); // ROAS 5 >= 3, clicks 40 >= 30
    expect(dashboard.totals).toEqual({ spend: 100, revenueAds: 500, clicks: 40, impressions: 1000 });
    expect(dashboard.totalTenantRevenue).toBe(5000);
    expect(dashboard.tacos).toBe(0.02); // 100/5000
  });

  it('campanha sem métrica no período: totais zerados, tier SEM_DADOS, sem quebrar o dashboard', async () => {
    const { service, campaigns, orderFinancials } = buildService();
    campaigns.listCampaigns.mockResolvedValue([
      {
        id: 'camp-1',
        channelCode: 'MERCADO_LIVRE',
        externalCampaignId: 'ext-1',
        name: 'Campanha Nova',
        status: 'ACTIVE',
        dailyBudget: null,
        lastSyncedAt: new Date(),
        lastAlertedTier: null,
        lastAlertedAt: null,
      },
    ]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([]);
    orderFinancials.listForPeriod.mockResolvedValue([]);

    const dashboard = await service.getDashboard('tenant-1', dateFrom, dateTo);

    expect(dashboard.campaigns[0].totals).toEqual({ spend: 0, revenueAds: 0, clicks: 0, impressions: 0 });
    expect(dashboard.campaigns[0].tier).toBe('SEM_DADOS');
    expect(dashboard.tacos).toBeNull(); // sem receita nenhuma no período
  });

  it('sem campanha nenhuma: dashboard vazio mas consistente (nunca lança erro)', async () => {
    const { service, campaigns, orderFinancials } = buildService();
    campaigns.listCampaigns.mockResolvedValue([]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([]);
    orderFinancials.listForPeriod.mockResolvedValue([]);

    const dashboard = await service.getDashboard('tenant-1', dateFrom, dateTo);

    expect(dashboard.campaigns).toEqual([]);
    expect(dashboard.totals).toEqual({ spend: 0, revenueAds: 0, clicks: 0, impressions: 0 });
  });
});
