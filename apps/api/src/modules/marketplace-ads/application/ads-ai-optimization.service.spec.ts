import { AdsAiOptimizationService } from './ads-ai-optimization.service';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { AdsInsightsService, AdsDashboard } from './ads-insights.service';
import { AdsActionSuggestionRepository } from './ports/ads-action-suggestion-repository.port';
import { CampaignOptimizationAdvisor } from '../../../shared/contracts/campaign-optimization-advisor.port';
import { FinancialPolicyReader } from '../../../shared/contracts/financial-policy-reader.port';
import { ProviderSyncLogRepository } from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import { ProviderHealthRepository } from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';

describe('AdsAiOptimizationService (Fase 4 — sugestão via IA)', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  function buildService() {
    const registry = { getAll: jest.fn(), findByCode: jest.fn(), findByMarketplaceCode: jest.fn() } as unknown as jest.Mocked<AdsProviderRegistry>;
    const insights = { getDashboard: jest.fn() } as unknown as jest.Mocked<AdsInsightsService>;
    const advisor = { suggestActions: jest.fn() } as unknown as jest.Mocked<CampaignOptimizationAdvisor>;
    const suggestions = {
      createPending: jest.fn(),
      findOpenSuggestion: jest.fn(),
      listPending: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AdsActionSuggestionRepository>;
    const financialPolicy = { getPolicy: jest.fn() } as unknown as jest.Mocked<FinancialPolicyReader>;
    const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn() } as unknown as jest.Mocked<ProviderSyncLogRepository>;
    const health = { recordSuccess: jest.fn(), recordFailure: jest.fn() } as unknown as jest.Mocked<ProviderHealthRepository>;
    const alerts = { emitAlert: jest.fn() } as unknown as jest.Mocked<AlertService>;

    const service = new AdsAiOptimizationService(registry, insights, advisor, suggestions, financialPolicy, syncLogs, health, alerts);
    return { service, registry, insights, advisor, suggestions, financialPolicy, syncLogs, health, alerts };
  }

  function fakeDashboard(overrides: Partial<AdsDashboard> = {}): AdsDashboard {
    return {
      periodFrom: new Date('2026-06-01'),
      periodTo: new Date('2026-07-01'),
      campaigns: [
        {
          campaignId: 'camp-1',
          channelCode: 'MERCADO_LIVRE',
          externalCampaignId: 'ext-1',
          name: 'Campanha 1',
          status: 'ACTIVE',
          totals: { spend: 100, revenueAds: 80, clicks: 40, impressions: 1000 },
          roas: 0.8,
          tier: 'CUSTO_PERDIDO',
          recommendation: 'Baixo volume e ROAS ruim — candidata a pausar.',
        },
      ],
      totals: { spend: 100, revenueAds: 80, clicks: 40, impressions: 1000 },
      totalTenantRevenue: 1000,
      tacos: 0.1,
      ...overrides,
    };
  }

  describe('runForTenant', () => {
    it('sai cedo (sem chamar a IA) quando não há campanhas elegíveis (todas SEM_DADOS)', async () => {
      const { service, insights, advisor, health, syncLogs } = buildService();
      insights.getDashboard.mockResolvedValue(
        fakeDashboard({ campaigns: [{ ...fakeDashboard().campaigns[0], tier: 'SEM_DADOS' }] }),
      );

      await service.runForTenant('tenant-1');

      expect(advisor.suggestActions).not.toHaveBeenCalled();
      expect(health.recordSuccess).toHaveBeenCalledWith('ADS_AI_ADVISOR');
      expect(syncLogs.finish).toHaveBeenCalledWith('log-1', { status: 'SUCCESS', candidatesFound: 0, candidatesApplied: 0 });
    });

    it('feliz: chama a IA com as campanhas elegíveis + targetRoas resolvido, cria a sugestão PENDING', async () => {
      const { service, insights, advisor, financialPolicy, suggestions, health } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockResolvedValue({
        suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS 0.8 abaixo da meta 3.', confidenceScore: 0.8 }],
      });
      suggestions.findOpenSuggestion.mockResolvedValue(null);

      await service.runForTenant('tenant-1');

      expect(advisor.suggestActions).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', targetRoas: 3, tacos: 0.1 }),
      );
      expect(suggestions.createPending).toHaveBeenCalledWith('tenant-1', 'camp-1', 'PAUSE_CAMPAIGN', 'ROAS 0.8 abaixo da meta 3.', {
        source: 'AI',
        confidenceScore: 0.8,
        metadata: undefined,
      });
      expect(health.recordSuccess).toHaveBeenCalledWith('ADS_AI_ADVISOR');
    });

    it('descarta sugestão com confidenceScore abaixo do mínimo (0.6 por padrão) — não cria sugestão', async () => {
      const { service, insights, advisor, financialPolicy, suggestions } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockResolvedValue({
        suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'Ambíguo, ROAS 0.8.', confidenceScore: 0.4 }],
      });

      await service.runForTenant('tenant-1');

      expect(suggestions.createPending).not.toHaveBeenCalled();
    });

    it('respeita ADS_AI_MIN_CONFIDENCE customizado via env', async () => {
      process.env = { ...originalEnv, ADS_AI_MIN_CONFIDENCE: '0.9' };
      const { service, insights, advisor, financialPolicy, suggestions } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockResolvedValue({
        suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS 0.8 abaixo da meta 3.', confidenceScore: 0.85 }],
      });

      await service.runForTenant('tenant-1');

      expect(suggestions.createPending).not.toHaveBeenCalled();
    });

    it('idempotência: não cria segunda sugestão se já existe uma aberta para a campanha+ação', async () => {
      const { service, insights, advisor, financialPolicy, suggestions } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockResolvedValue({
        suggestions: [{ campaignId: 'camp-1', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS 0.8 abaixo da meta 3.', confidenceScore: 0.9 }],
      });
      suggestions.findOpenSuggestion.mockResolvedValue({
        id: 'sugg-existente',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        externalCampaignId: 'ext-1',
        campaignName: 'Campanha 1',
        channelCode: 'MERCADO_LIVRE',
        actionType: 'PAUSE_CAMPAIGN',
        status: 'PENDING',
        reason: 'já sugerido antes (rule-based)',
        suggestedAt: new Date(),
        resolvedAt: null,
        resolvedByUserId: null,
        failureReason: null,
        source: 'RULE_BASED',
        confidenceScore: null,
        metadata: null,
      });

      await service.runForTenant('tenant-1');

      expect(suggestions.createPending).not.toHaveBeenCalled();
    });

    it('descarta sugestão para campaignId fora do conjunto elegível deste ciclo (defesa extra além do adapter)', async () => {
      const { service, insights, advisor, financialPolicy, suggestions } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockResolvedValue({
        suggestions: [{ campaignId: 'camp-fantasma', actionType: 'PAUSE_CAMPAIGN', reasoning: 'ROAS 0.1 muito baixo.', confidenceScore: 0.95 }],
      });

      await service.runForTenant('tenant-1');

      expect(suggestions.createPending).not.toHaveBeenCalled();
    });

    it('IA indisponível: nunca lança, registra FAILED no log de sync + alerta WARNING', async () => {
      const { service, insights, advisor, financialPolicy, health, syncLogs, alerts } = buildService();
      insights.getDashboard.mockResolvedValue(fakeDashboard());
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });
      advisor.suggestActions.mockRejectedValue(new Error('Anthropic API retornou HTTP 500'));

      await expect(service.runForTenant('tenant-1')).resolves.toBeUndefined();

      expect(health.recordFailure).toHaveBeenCalledWith('ADS_AI_ADVISOR', expect.stringContaining('HTTP 500'));
      expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED' }));
      expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ source: 'AdsAiOptimizationService', severity: 'WARNING' }));
    });
  });

  describe('runAll', () => {
    it('itera cada provider registrado e cada tenant que ele lista', async () => {
      const { service, registry, insights, financialPolicy, advisor } = buildService();
      const providerA = { code: 'MERCADO_LIVRE_ADS', listTenantIdsToSync: jest.fn().mockResolvedValue(['tenant-1', 'tenant-2']) };
      registry.getAll.mockReturnValue([providerA] as never);
      insights.getDashboard.mockResolvedValue(fakeDashboard({ campaigns: [] }));
      financialPolicy.getPolicy.mockResolvedValue({ taxRate: 0, minProfitMargin: 0, targetRoas: 3 });

      await service.runAll();

      expect(insights.getDashboard).toHaveBeenCalledTimes(2);
      expect(advisor.suggestActions).not.toHaveBeenCalled(); // dashboard sem campanhas -> sai cedo
    });

    it('pula provider sem listTenantIdsToSync', async () => {
      const { service, registry, insights } = buildService();
      registry.getAll.mockReturnValue([{ code: 'X' }] as never);

      await service.runAll();

      expect(insights.getDashboard).not.toHaveBeenCalled();
    });
  });
});
