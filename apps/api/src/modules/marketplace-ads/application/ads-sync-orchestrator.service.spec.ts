import { AdsSyncOrchestrator } from './ads-sync-orchestrator.service';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { AdsCampaignRepository } from './ports/ads-campaign-repository.port';
import { AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';
import { AdsAlertingService } from './ads-alerting.service';
import { ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';
import { AdsCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';

describe('AdsSyncOrchestrator', () => {
  function buildOrchestrator() {
    const registry = { getAll: jest.fn(), findByCode: jest.fn() } as unknown as jest.Mocked<AdsProviderRegistry>;
    const campaigns = {
      upsertCampaign: jest.fn(),
      upsertMetricSnapshot: jest.fn(),
      // Defaults resolvidos (não jest.fn() "cru") porque AdsAlertingService
      // real (abaixo) é exercitado dentro deste teste, não mockado — mesmas
      // fakes de campaigns/alerts que o orquestrador já usa.
      listCampaigns: jest.fn().mockResolvedValue([]),
      sumMetricsByCampaign: jest.fn().mockResolvedValue([]),
      updateAlertState: jest.fn(),
    } as unknown as jest.Mocked<AdsCampaignRepository>;
    const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn() } as unknown as jest.Mocked<ProviderSyncLogRepository>;
    const health = { recordSuccess: jest.fn(), recordFailure: jest.fn() } as unknown as jest.Mocked<ProviderHealthRepository>;
    const alerts = { emitAlert: jest.fn() } as unknown as jest.Mocked<AlertService>;
    const actionSuggestions = {
      createPending: jest.fn(),
      findOpenSuggestion: jest.fn().mockResolvedValue(null),
      listPending: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AdsActionSuggestionRepository>;
    // AdsAlertingService REAL (não mockado) — reaproveita as mesmas fakes de
    // campaigns/alerts/actionSuggestions, então o pipeline de alertas é
    // exercitado de verdade dentro dos testes do orquestrador, sem precisar
    // duplicar sua própria lógica de mock aqui (ver ads-alerting.service.spec.ts
    // para os testes dedicados da máquina de estado ALERT/RESET/NONE).
    const alerting = new AdsAlertingService(campaigns, alerts, actionSuggestions);

    const orchestrator = new AdsSyncOrchestrator(registry, campaigns, syncLogs, health, alerts, alerting);
    return { orchestrator, registry, campaigns, syncLogs, health, alerts, alerting, actionSuggestions };
  }

  function fakeProvider(overrides: Partial<AdsCapableProvider> = {}): jest.Mocked<AdsCapableProvider> {
    return {
      code: 'MERCADO_LIVRE_ADS',
      marketplaceCode: 'MERCADO_LIVRE',
      sourceType: 'OFFICIAL_API',
      capabilities: ['ADS'] as any,
      healthCheck: jest.fn(),
      listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1']),
      fetchAdsCampaigns: jest.fn().mockResolvedValue([]),
      fetchAdsMetrics: jest.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as jest.Mocked<AdsCapableProvider>;
  }

  it('provider não registrado: não chama nada, só loga', async () => {
    const { orchestrator, registry, syncLogs } = buildOrchestrator();
    registry.findByCode.mockReturnValue(undefined);

    await orchestrator.syncProvider('DESCONHECIDO');

    expect(syncLogs.start).not.toHaveBeenCalled();
  });

  it('provider sem listTenantIdsToSync: pulado sem erro', async () => {
    const { orchestrator, registry, syncLogs } = buildOrchestrator();
    const provider = fakeProvider({ listTenantIdsToSync: undefined });
    registry.findByCode.mockReturnValue(provider);

    await orchestrator.syncProvider(provider.code);

    expect(syncLogs.start).not.toHaveBeenCalled();
  });

  it('fluxo feliz: busca campanhas, faz upsert, busca métricas casando pelo id interno, marca SUCCESS', async () => {
    const { orchestrator, registry, campaigns, syncLogs, health } = buildOrchestrator();
    const provider = fakeProvider({
      fetchAdsCampaigns: jest.fn().mockResolvedValue([
        { externalCampaignId: 'ext-1', name: 'Campanha 1', status: 'ACTIVE', dailyBudget: 20 },
      ]),
      fetchAdsMetrics: jest.fn().mockResolvedValue([
        { externalCampaignId: 'ext-1', periodDate: new Date('2026-07-01'), spend: 50, revenueAds: 200, clicks: 10, impressions: 500 },
      ]),
    });
    registry.findByCode.mockReturnValue(provider);
    campaigns.upsertCampaign.mockResolvedValue('internal-uuid-1');

    await orchestrator.syncProvider(provider.code);

    expect(campaigns.upsertCampaign).toHaveBeenCalledWith('tenant-1', 'MERCADO_LIVRE', expect.objectContaining({ externalCampaignId: 'ext-1' }));
    expect(campaigns.upsertMetricSnapshot).toHaveBeenCalledWith(
      'tenant-1',
      'internal-uuid-1',
      expect.objectContaining({ externalCampaignId: 'ext-1', spend: 50 }),
    );
    expect(health.recordSuccess).toHaveBeenCalledWith(provider.code);
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('métrica sem campanha correspondente no mesmo ciclo: pulada, não interrompe o restante do lote', async () => {
    const { orchestrator, registry, campaigns, syncLogs } = buildOrchestrator();
    const provider = fakeProvider({
      fetchAdsCampaigns: jest.fn().mockResolvedValue([]), // nenhuma campanha upsertada
      fetchAdsMetrics: jest.fn().mockResolvedValue([
        { externalCampaignId: 'orfa', periodDate: new Date('2026-07-01'), spend: 10, revenueAds: 0, clicks: 1, impressions: 5 },
      ]),
    });
    registry.findByCode.mockReturnValue(provider);

    await orchestrator.syncProvider(provider.code);

    expect(campaigns.upsertMetricSnapshot).not.toHaveBeenCalled();
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('falha no fetch de campanhas: marca FAILED + registra falha de saúde + emite alerta ERROR', async () => {
    const { orchestrator, registry, syncLogs, health, alerts } = buildOrchestrator();
    const provider = fakeProvider({
      fetchAdsCampaigns: jest.fn().mockRejectedValue(new Error('Mercado Livre indisponível')),
    });
    registry.findByCode.mockReturnValue(provider);

    await orchestrator.syncProvider(provider.code);

    expect(health.recordFailure).toHaveBeenCalledWith(provider.code, 'Mercado Livre indisponível');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED' }));
    expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'ERROR' }));
  });

  it('falha ao upsertar UMA campanha: emite alerta WARNING mas continua o lote (não marca FAILED)', async () => {
    const { orchestrator, registry, campaigns, syncLogs, alerts } = buildOrchestrator();
    const provider = fakeProvider({
      fetchAdsCampaigns: jest.fn().mockResolvedValue([
        { externalCampaignId: 'ext-1', name: 'Campanha 1', status: 'ACTIVE', dailyBudget: null },
        { externalCampaignId: 'ext-2', name: 'Campanha 2', status: 'ACTIVE', dailyBudget: null },
      ]),
    });
    registry.findByCode.mockReturnValue(provider);
    campaigns.upsertCampaign
      .mockRejectedValueOnce(new Error('violação de unique constraint'))
      .mockResolvedValueOnce('internal-uuid-2');

    await orchestrator.syncProvider(provider.code);

    expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'WARNING' }));
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS', candidatesApplied: 1 }));
  });

  it('syncAll percorre todos os providers registrados', async () => {
    const { orchestrator, registry, syncLogs } = buildOrchestrator();
    const providerA = fakeProvider({ code: 'A' });
    const providerB = fakeProvider({ code: 'B' });
    registry.getAll.mockReturnValue([providerA, providerB]);
    registry.findByCode.mockImplementation((code) => (code === 'A' ? providerA : providerB));

    await orchestrator.syncAll();

    expect(syncLogs.start).toHaveBeenCalledTimes(2);
  });

  it('Fase 2 — após sincronizar, avalia alertas: campanha em CUSTO_PERDIDO dispara alerta e não derruba o sync', async () => {
    const { orchestrator, registry, campaigns, syncLogs, alerts } = buildOrchestrator();
    const provider = fakeProvider();
    registry.findByCode.mockReturnValue(provider);
    // Estado JÁ persistido (simula o resultado do upsert que acabou de
    // rodar): 1 campanha com baixo volume e ROAS ruim => CUSTO_PERDIDO.
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
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }]);

    await orchestrator.syncProvider(provider.code);

    expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ source: 'AdsAlertingService', severity: 'WARNING' }));
    expect(campaigns.updateAlertState).toHaveBeenCalledWith('camp-1', 'CUSTO_PERDIDO', expect.any(Date));
    // Sync continua SUCCESS — avaliação de alerta nunca reverte o resultado do sync.
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('Fase 2 — falha ao avaliar alertas não derruba o sync (try/catch isolado)', async () => {
    const { orchestrator, registry, campaigns, syncLogs, health } = buildOrchestrator();
    const provider = fakeProvider();
    registry.findByCode.mockReturnValue(provider);
    campaigns.listCampaigns.mockRejectedValue(new Error('falha ao ler campanhas para alerta'));

    await orchestrator.syncProvider(provider.code);

    expect(health.recordSuccess).toHaveBeenCalledWith(provider.code);
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'SUCCESS' }));
  });

  it('Fase 3 — campanha em CUSTO_PERDIDO também gera uma AdsActionSuggestion pendente', async () => {
    const { orchestrator, registry, campaigns, actionSuggestions } = buildOrchestrator();
    const provider = fakeProvider();
    registry.findByCode.mockReturnValue(provider);
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
    campaigns.sumMetricsByCampaign.mockResolvedValue([{ campaignId: 'camp-1', spend: 50, revenueAds: 40, clicks: 5, impressions: 200 }]);

    await orchestrator.syncProvider(provider.code);

    expect(actionSuggestions.createPending).toHaveBeenCalledWith('tenant-1', 'camp-1', 'PAUSE_CAMPAIGN', expect.any(String));
  });
});
