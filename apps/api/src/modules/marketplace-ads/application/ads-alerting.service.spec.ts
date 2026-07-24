import { AdsAlertingService } from './ads-alerting.service';
import { AdsCampaignRepository, AdsCampaignSummary } from './ports/ads-campaign-repository.port';
import { AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';

describe('AdsAlertingService', () => {
  function buildService() {
    const campaigns = {
      upsertCampaign: jest.fn(),
      upsertMetricSnapshot: jest.fn(),
      listCampaigns: jest.fn(),
      sumMetricsByCampaign: jest.fn(),
      updateAlertState: jest.fn(),
    } as unknown as jest.Mocked<AdsCampaignRepository>;
    const alerts = { emitAlert: jest.fn() } as unknown as jest.Mocked<AlertService>;
    const actionSuggestions = {
      createPending: jest.fn(),
      findOpenSuggestion: jest.fn().mockResolvedValue(null),
      listPending: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AdsActionSuggestionRepository>;
    const service = new AdsAlertingService(campaigns, alerts, actionSuggestions);
    return { service, campaigns, alerts, actionSuggestions };
  }

  function fakeCampaign(overrides: Partial<AdsCampaignSummary> = {}): AdsCampaignSummary {
    return {
      id: 'camp-1',
      channelCode: 'MERCADO_LIVRE',
      externalCampaignId: 'ext-1',
      name: 'Campanha 1',
      status: 'ACTIVE',
      dailyBudget: 20,
      lastSyncedAt: new Date(),
      lastAlertedTier: null,
      lastAlertedAt: null,
      ...overrides,
    };
  }

  const dateFrom = new Date('2026-07-01');
  const dateTo = new Date('2026-07-31');

  it('sem campanha nenhuma: não chama sumMetricsByCampaign nem alerta (sai cedo)', async () => {
    const { service, campaigns, alerts } = buildService();
    campaigns.listCampaigns.mockResolvedValue([]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(campaigns.sumMetricsByCampaign).not.toHaveBeenCalled();
    expect(alerts.emitAlert).not.toHaveBeenCalled();
  });

  it('campanha degrada para CUSTO_PERDIDO pela primeira vez: emite alerta WARNING, grava o estado E sugere pausar', async () => {
    const { service, campaigns, alerts, actionSuggestions } = buildService();
    campaigns.listCampaigns.mockResolvedValue([fakeCampaign({ lastAlertedTier: null })]);
    // baixo volume (clicks 5 < 30) + ROAS ruim (40/50 < 3) => CUSTO_PERDIDO
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'AdsAlertingService', severity: 'WARNING', context: expect.objectContaining({ tier: 'CUSTO_PERDIDO' }) }),
    );
    expect(campaigns.updateAlertState).toHaveBeenCalledWith('camp-1', 'CUSTO_PERDIDO', expect.any(Date));
    expect(actionSuggestions.findOpenSuggestion).toHaveBeenCalledWith('camp-1', 'PAUSE_CAMPAIGN');
    expect(actionSuggestions.createPending).toHaveBeenCalledWith(
      'tenant-1',
      'camp-1',
      'PAUSE_CAMPAIGN',
      expect.stringContaining('pausar'),
    );
  });

  it('já existe sugestão aberta (PENDING/CONFIRMED) para a campanha: não cria uma segunda', async () => {
    const { service, campaigns, actionSuggestions } = buildService();
    campaigns.listCampaigns.mockResolvedValue([fakeCampaign({ lastAlertedTier: null })]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }]);
    actionSuggestions.findOpenSuggestion.mockResolvedValue({
      id: 'sugg-1',
      tenantId: 'tenant-1',
      campaignId: 'camp-1',
      externalCampaignId: 'ext-1',
      campaignName: 'Campanha 1',
      channelCode: 'MERCADO_LIVRE',
      actionType: 'PAUSE_CAMPAIGN',
      status: 'PENDING',
      reason: 'já sugerido antes',
      suggestedAt: new Date(),
      resolvedAt: null,
      resolvedByUserId: null,
      failureReason: null,
      source: 'RULE_BASED',
      confidenceScore: null,
      metadata: null,
    });

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(actionSuggestions.createPending).not.toHaveBeenCalled();
  });

  it('campanha continua CUSTO_PERDIDO e já tinha sido alertada: não repete o alerta nem sugere de novo', async () => {
    const { service, campaigns, alerts, actionSuggestions } = buildService();
    campaigns.listCampaigns.mockResolvedValue([fakeCampaign({ lastAlertedTier: 'CUSTO_PERDIDO' })]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(alerts.emitAlert).not.toHaveBeenCalled();
    expect(campaigns.updateAlertState).not.toHaveBeenCalled();
    expect(actionSuggestions.createPending).not.toHaveBeenCalled();
  });

  it('campanha se recupera de CUSTO_PERDIDO: reseta o estado, sem emitir alerta nem sugerir ação', async () => {
    const { service, campaigns, alerts, actionSuggestions } = buildService();
    campaigns.listCampaigns.mockResolvedValue([fakeCampaign({ lastAlertedTier: 'CUSTO_PERDIDO' })]);
    // ROAS saudável + volume relevante => ESTRELA
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 100, revenueAds: 500, clicks: 50, impressions: 2000 }]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(alerts.emitAlert).not.toHaveBeenCalled();
    expect(campaigns.updateAlertState).toHaveBeenCalledWith('camp-1', null, null);
    expect(actionSuggestions.createPending).not.toHaveBeenCalled();
  });

  it('campanha sem métrica no período (SEM_DADOS): nunca alerta, mesmo já tendo sido alertada antes (RESET)', async () => {
    const { service, campaigns, alerts } = buildService();
    campaigns.listCampaigns.mockResolvedValue([fakeCampaign({ lastAlertedTier: 'CUSTO_PERDIDO' })]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(alerts.emitAlert).not.toHaveBeenCalled();
    expect(campaigns.updateAlertState).toHaveBeenCalledWith('camp-1', null, null);
  });

  it('falha ao avaliar uma campanha não impede a avaliação das demais', async () => {
    const { service, campaigns, alerts } = buildService();
    campaigns.listCampaigns.mockResolvedValue([
      fakeCampaign({ id: 'camp-1', externalCampaignId: 'ext-1' }),
      fakeCampaign({ id: 'camp-2', externalCampaignId: 'ext-2' }),
    ]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([
      { campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 },
      { campaignId: 'camp-2', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 },
    ]);
    campaigns.updateAlertState.mockRejectedValueOnce(new Error('DB indisponível')).mockResolvedValueOnce(undefined);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(campaigns.updateAlertState).toHaveBeenCalledTimes(2);
    expect(alerts.emitAlert).toHaveBeenCalledTimes(2);
  });

  it('múltiplas campanhas, cada uma avaliada independentemente', async () => {
    const { service, campaigns, alerts } = buildService();
    campaigns.listCampaigns.mockResolvedValue([
      fakeCampaign({ id: 'camp-1', externalCampaignId: 'ext-1', lastAlertedTier: null }),
      fakeCampaign({ id: 'camp-2', externalCampaignId: 'ext-2', lastAlertedTier: null }),
    ]);
    campaigns.sumMetricsByCampaign.mockResolvedValue([
      { campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }, // CUSTO_PERDIDO
      { campaignId: 'camp-2', spend: 100, revenueAds: 500, clicks: 50, impressions: 2000 }, // ESTRELA
    ]);

    await service.evaluateAndAlert('tenant-1', 'MERCADO_LIVRE', dateFrom, dateTo);

    expect(alerts.emitAlert).toHaveBeenCalledTimes(1);
    expect(campaigns.updateAlertState).toHaveBeenCalledWith('camp-1', 'CUSTO_PERDIDO', expect.any(Date));
    expect(campaigns.updateAlertState).not.toHaveBeenCalledWith('camp-2', expect.anything(), expect.anything());
  });
});
