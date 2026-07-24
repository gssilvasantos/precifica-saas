import { AdsActionDispatcherService } from './ads-action-dispatcher.service';
import { AdsActionSuggestionRepository, AdsActionSuggestionSummary } from './ports/ads-action-suggestion-repository.port';
import { AdsProviderRegistry } from './ads-provider-registry.service';
import { AlertService } from '../../../shared/observability/ports/alert-service.port';
import { AdsActionCapableProvider, AdsCapableProvider, ProviderCapability } from '../../../shared/contracts/marketplace-provider.contract';

describe('AdsActionDispatcherService (Fase 3 — Safety Lock)', () => {
  function buildService() {
    const suggestions = {
      createPending: jest.fn(),
      findOpenSuggestion: jest.fn(),
      listPending: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<AdsActionSuggestionRepository>;
    const registry = { getAll: jest.fn(), findByCode: jest.fn(), findByMarketplaceCode: jest.fn() } as unknown as jest.Mocked<AdsProviderRegistry>;
    const alerts = { emitAlert: jest.fn() } as unknown as jest.Mocked<AlertService>;
    const service = new AdsActionDispatcherService(suggestions, registry, alerts);
    return { service, suggestions, registry, alerts };
  }

  function fakePendingSuggestion(overrides: Partial<AdsActionSuggestionSummary> = {}): AdsActionSuggestionSummary {
    return {
      id: 'sugg-1',
      tenantId: 'tenant-1',
      campaignId: 'camp-1',
      externalCampaignId: 'ext-1',
      campaignName: 'Campanha 1',
      channelCode: 'MERCADO_LIVRE',
      actionType: 'PAUSE_CAMPAIGN',
      status: 'PENDING',
      reason: 'Baixo volume e ROAS ruim — candidata a pausar.',
      suggestedAt: new Date(),
      resolvedAt: null,
      resolvedByUserId: null,
      failureReason: null,
      source: 'RULE_BASED',
      confidenceScore: null,
      metadata: null,
      ...overrides,
    };
  }

  // Precisa satisfazer AdsCapableProvider TAMBÉM (não só AdsActionCapableProvider):
  // registry.findByMarketplaceCode devolve AdsCapableProvider[] de verdade (são
  // interfaces irmãs, nenhuma estende a outra — ver AdsActionDispatcherService),
  // então o fake tem que valer para as duas para poder entrar nesse array.
  function fakeActionCapableProvider(
    overrides: Partial<AdsCapableProvider & AdsActionCapableProvider> = {},
  ): jest.Mocked<AdsCapableProvider & AdsActionCapableProvider> {
    return {
      code: 'MERCADO_LIVRE_ADS',
      marketplaceCode: 'MERCADO_LIVRE',
      sourceType: 'OFFICIAL_API',
      capabilities: [ProviderCapability.ADS, ProviderCapability.ADS_ACTIONS],
      healthCheck: jest.fn(),
      fetchAdsCampaigns: jest.fn(),
      fetchAdsMetrics: jest.fn(),
      pauseCampaign: jest.fn(),
      ...overrides,
    } as unknown as jest.Mocked<AdsCapableProvider & AdsActionCapableProvider>;
  }

  describe('confirmAndApply', () => {
    it('lança erro se a sugestão não existe', async () => {
      const { service, suggestions } = buildService();
      suggestions.findById.mockResolvedValue(null);

      await expect(service.confirmAndApply('tenant-1', 'sugg-1', 'user-1')).rejects.toThrow(/não encontrada/);
    });

    it('lança erro se a sugestão já foi resolvida (não está mais PENDING) — sem chamar provider', async () => {
      const { service, suggestions, registry } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion({ status: 'APPLIED' }));

      await expect(service.confirmAndApply('tenant-1', 'sugg-1', 'user-1')).rejects.toThrow(/não está mais PENDING/);
      expect(registry.findByMarketplaceCode).not.toHaveBeenCalled();
    });

    it('feliz: marca CONFIRMED, chama pauseCampaign no provider certo, marca APPLIED', async () => {
      const { service, suggestions, registry } = buildService();
      const suggestion = fakePendingSuggestion();
      suggestions.findById.mockResolvedValue(suggestion);
      const provider = fakeActionCapableProvider();
      provider.pauseCampaign.mockResolvedValue({ success: true });
      registry.findByMarketplaceCode.mockReturnValue([provider]);

      const result = await service.confirmAndApply('tenant-1', 'sugg-1', 'user-1');

      expect(suggestions.updateStatus).toHaveBeenNthCalledWith(1, 'sugg-1', 'CONFIRMED', { resolvedByUserId: 'user-1' });
      expect(provider.pauseCampaign).toHaveBeenCalledWith({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, 'ext-1');
      expect(suggestions.updateStatus).toHaveBeenNthCalledWith(2, 'sugg-1', 'APPLIED', { resolvedByUserId: 'user-1' });
      expect(result.status).toBe('APPLIED');
    });

    it('nenhum provider ADS_ACTIONS registrado para o canal: marca FAILED e alerta ERROR, sem lançar', async () => {
      const { service, suggestions, registry, alerts } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion());
      registry.findByMarketplaceCode.mockReturnValue([]); // nenhum provider do canal

      const result = await service.confirmAndApply('tenant-1', 'sugg-1', 'user-1');

      expect(result.status).toBe('FAILED');
      expect(suggestions.updateStatus).toHaveBeenNthCalledWith(2, 'sugg-1', 'FAILED', expect.objectContaining({ resolvedByUserId: 'user-1' }));
      expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ source: 'AdsActionDispatcherService', severity: 'ERROR' }));
    });

    it('provider devolve falha (success: false): marca FAILED com a mensagem do provider e alerta ERROR', async () => {
      const { service, suggestions, registry, alerts } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion());
      const provider = fakeActionCapableProvider();
      provider.pauseCampaign.mockResolvedValue({ success: false, message: 'Mercado Livre retornou HTTP 500' });
      registry.findByMarketplaceCode.mockReturnValue([provider]);

      const result = await service.confirmAndApply('tenant-1', 'sugg-1', 'user-1');

      expect(result.status).toBe('FAILED');
      expect(result.failureReason).toBe('Mercado Livre retornou HTTP 500');
      expect(alerts.emitAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'ERROR' }));
    });

    it('ignora providers do canal que não implementam ADS_ACTIONS (só leitura)', async () => {
      const { service, suggestions, registry } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion());
      const readOnlyProvider = { code: 'X', marketplaceCode: 'MERCADO_LIVRE', capabilities: [ProviderCapability.ADS] } as any;
      registry.findByMarketplaceCode.mockReturnValue([readOnlyProvider]);

      const result = await service.confirmAndApply('tenant-1', 'sugg-1', 'user-1');

      expect(result.status).toBe('FAILED');
      expect(result.failureReason).toMatch(/Nenhum provider/);
    });
  });

  describe('reject', () => {
    it('lança erro se a sugestão não está PENDING', async () => {
      const { service, suggestions } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion({ status: 'REJECTED' }));

      await expect(service.reject('tenant-1', 'sugg-1', 'user-1')).rejects.toThrow(/não está mais PENDING/);
    });

    it('feliz: marca REJECTED, nunca chama o provider', async () => {
      const { service, suggestions, registry } = buildService();
      suggestions.findById.mockResolvedValue(fakePendingSuggestion());

      const result = await service.reject('tenant-1', 'sugg-1', 'user-1');

      expect(suggestions.updateStatus).toHaveBeenCalledWith('sugg-1', 'REJECTED', { resolvedByUserId: 'user-1' });
      expect(registry.findByMarketplaceCode).not.toHaveBeenCalled();
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('listPending', () => {
    it('delega para o repositório (sem dataMode explícito — undefined é repassado como está, mesmo padrão de OrdersController)', async () => {
      const { service, suggestions } = buildService();
      suggestions.listPending.mockResolvedValue([fakePendingSuggestion()]);

      const result = await service.listPending('tenant-1');

      // O service sempre repassa os dois parâmetros posicionais
      // (`this.suggestions.listPending(tenantId, dataMode)`), então quando
      // dataMode não é passado pelo chamador o mock recebe ('tenant-1',
      // undefined) — dois argumentos, não um. Regressão do Bloco 1 (Demo
      // Mode em Ads): este teste não tinha sido atualizado quando o
      // threading de dataMode foi adicionado a listPending.
      expect(suggestions.listPending).toHaveBeenCalledWith('tenant-1', undefined);
      expect(result).toHaveLength(1);
    });

    it('repassa dataMode explícito (Demo Mode) para o repositório', async () => {
      const { service, suggestions } = buildService();
      suggestions.listPending.mockResolvedValue([]);

      await service.listPending('tenant-1', 'DEMO');

      expect(suggestions.listPending).toHaveBeenCalledWith('tenant-1', 'DEMO');
    });
  });
});
