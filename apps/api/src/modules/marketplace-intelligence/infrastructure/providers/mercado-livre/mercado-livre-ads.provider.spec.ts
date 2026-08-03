import { MercadoLivreAdsProvider, normalizeMlAdsItemMetric } from './mercado-livre-ads.provider';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

describe('MercadoLivreAdsProvider (Módulo de Ads, Fases 1-3)', () => {
  function buildProvider() {
    const client = {
      fetchAdvertiserId: jest.fn(),
      fetchAdsCampaigns: jest.fn(),
      fetchAdsCampaignMetrics: jest.fn(),
      fetchAdsItemMetrics: jest.fn().mockResolvedValue([]),
      pauseCampaign: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;
    const connection = {
      listActiveTenantIds: jest.fn(),
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;
    const provider = new MercadoLivreAdsProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara as capacidades ADS e ADS_ACTIONS e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('MERCADO_LIVRE');
    expect(provider.capabilities).toContain('ADS');
    expect(provider.capabilities).toContain('ADS_ACTIONS');
  });

  describe('fetchAdsCampaigns', () => {
    it('sem tenantId: devolve [] sem chamar nada (ads é sempre por vendedor)', async () => {
      const { provider, connection, client } = buildProvider();
      const result = await provider.fetchAdsCampaigns({ marketplaceCode: 'MERCADO_LIVRE' });
      expect(result).toEqual([]);
      expect(connection.getValidAccessToken).not.toHaveBeenCalled();
      expect(client.fetchAdsCampaigns).not.toHaveBeenCalled();
    });

    it('sem advertiser_id resolvido: devolve [] sem chamar fetchAdsCampaigns', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue(null);

      const result = await provider.fetchAdsCampaigns({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });
      expect(result).toEqual([]);
      expect(client.fetchAdsCampaigns).not.toHaveBeenCalled();
    });

    it('busca advertiser_id + campanhas e normaliza para RawAdsCampaignCandidate', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.fetchAdsCampaigns.mockResolvedValue([
        { id: '123', name: 'Campanha Teste', status: 'active', budget: 50 },
        { id: '456', name: 'Campanha Pausada', status: 'paused', budget: 10 },
      ]);

      const result = await provider.fetchAdsCampaigns({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

      expect(client.fetchAdsCampaigns).toHaveBeenCalledWith('adv-1', 'token-valido');
      expect(result).toEqual([
        { externalCampaignId: '123', name: 'Campanha Teste', status: 'ACTIVE', dailyBudget: 50 },
        { externalCampaignId: '456', name: 'Campanha Pausada', status: 'PAUSED', dailyBudget: 10 },
      ]);
    });

    it('lança erro explícito quando a campanha não tem id reconhecível (nunca inventa um valor)', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.fetchAdsCampaigns.mockResolvedValue([{ name: 'Sem id' }]);

      await expect(provider.fetchAdsCampaigns({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' })).rejects.toThrow(
        /sem id reconhecível/,
      );
    });
  });

  describe('fetchAdsMetrics', () => {
    it('lança erro quando a janela pedida excede 90 dias (limite documentado da API)', async () => {
      const { provider } = buildProvider();
      const dateFrom = new Date('2026-01-01');
      const dateTo = new Date('2026-06-01'); // > 90 dias
      await expect(
        provider.fetchAdsMetrics({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, dateFrom, dateTo),
      ).rejects.toThrow(/90 dias/);
    });

    it('busca e normaliza métricas dentro da janela permitida', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.fetchAdsCampaignMetrics.mockResolvedValue([
        { campaign_id: '123', date: '2026-07-01', cost: 100, direct_amount: 450, clicks: 40, prints: 1000 },
      ]);

      const dateFrom = new Date('2026-07-01');
      const dateTo = new Date('2026-07-10');
      const result = await provider.fetchAdsMetrics({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, dateFrom, dateTo);

      expect(result).toEqual([
        {
          externalCampaignId: '123',
          periodDate: new Date('2026-07-01'),
          spend: 100,
          revenueAds: 450,
          clicks: 40,
          impressions: 1000,
        },
      ]);
    });
  });

  describe('pauseCampaign (Fase 3 — Safety Lock)', () => {
    it('sem tenantId: devolve success false sem chamar nada', async () => {
      const { provider, client } = buildProvider();
      const result = await provider.pauseCampaign({ marketplaceCode: 'MERCADO_LIVRE' }, 'ext-1');
      expect(result.success).toBe(false);
      expect(client.pauseCampaign).not.toHaveBeenCalled();
    });

    it('sem advertiser_id resolvido: devolve success false com mensagem explicativa', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue(null);

      const result = await provider.pauseCampaign({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, 'ext-1');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/advertiser_id/);
      expect(client.pauseCampaign).not.toHaveBeenCalled();
    });

    it('resolve advertiser + chama pauseCampaign no client e devolve success true', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.pauseCampaign.mockResolvedValue(undefined);

      const result = await provider.pauseCampaign({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, 'ext-1');

      expect(client.pauseCampaign).toHaveBeenCalledWith('adv-1', 'token-valido', 'ext-1');
      expect(result).toEqual({ success: true });
    });

    it('falha do client (ex.: HTTP não-ok): devolve success false com a mensagem do erro, nunca lança', async () => {
      const { provider, connection, client } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.pauseCampaign.mockRejectedValue(new Error('Mercado Livre retornou HTTP 500'));

      const result = await provider.pauseCampaign({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, 'ext-1');

      expect(result).toEqual({ success: false, message: 'Mercado Livre retornou HTTP 500' });
    });
  });

  // Métricas por ANÚNCIO (01/08/2026) — confirmado na documentação oficial
  // que o ML entrega `cost` no nível do item. É o dado que faz a
  // publicidade chegar ao SKU no DRE sem estimativa.
  describe('normalizeMlAdsItemMetric', () => {
    it('normaliza a resposta esperada da API', () => {
      const result = normalizeMlAdsItemMetric({
        item_id: 'MLB3456789012',
        date: '2026-07-15',
        cost: 42.5,
        units_quantity: 3,
        clicks: 120,
        prints: 4500,
      });

      expect(result).toEqual({
        externalItemId: 'MLB3456789012',
        periodDate: new Date('2026-07-15'),
        spend: 42.5,
        attributedUnits: 3,
        clicks: 120,
        impressions: 4500,
      });
    });

    it('aceita nomes alternativos de campo documentados', () => {
      const result = normalizeMlAdsItemMetric({
        id: 'MLB1',
        date: '2026-07-15',
        spend: 10,
        direct_units_quantity: 2,
        impressions: 100,
      });

      expect(result?.externalItemId).toBe('MLB1');
      expect(result?.spend).toBe(10);
      expect(result?.attributedUnits).toBe(2);
      expect(result?.impressions).toBe(100);
    });

    it('métrica sem custo vira zero, não some — anúncio sem gasto no dia é dado válido', () => {
      const result = normalizeMlAdsItemMetric({ item_id: 'MLB1', date: '2026-07-15' });
      expect(result?.spend).toBe(0);
    });

    // Devolver null (em vez de lançar) é o que permite um anúncio em
    // formato inesperado ser descartado sem derrubar a captura dos outros.
    it('devolve null quando falta o id do anúncio', () => {
      expect(normalizeMlAdsItemMetric({ date: '2026-07-15', cost: 10 })).toBeNull();
    });

    it('devolve null quando falta a data', () => {
      expect(normalizeMlAdsItemMetric({ item_id: 'MLB1', cost: 10 })).toBeNull();
    });

    it('devolve null quando a data é inválida — nunca grava Invalid Date', () => {
      expect(normalizeMlAdsItemMetric({ item_id: 'MLB1', date: 'nao-e-data', cost: 10 })).toBeNull();
    });

    it('devolve null para payload que não é objeto', () => {
      expect(normalizeMlAdsItemMetric('texto solto')).toBeNull();
      expect(normalizeMlAdsItemMetric(null)).toBeNull();
    });
  });

  describe('fetchAdsItemMetrics', () => {
    it('respeita o limite de 90 dias da API, igual às métricas por campanha', async () => {
      const { provider } = buildProvider();
      const dateTo = new Date('2026-07-31');
      const dateFrom = new Date('2026-01-01'); // muito além de 90 dias

      await expect(
        provider.fetchAdsItemMetrics({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' }, dateFrom, dateTo),
      ).rejects.toThrow(/excede o limite de 90 dias/);
    });

    it('sem tenantId devolve vazio — métrica de ads é sempre por vendedor', async () => {
      const { provider } = buildProvider();

      const result = await provider.fetchAdsItemMetrics(
        { marketplaceCode: 'MERCADO_LIVRE' },
        new Date('2026-07-01'),
        new Date('2026-07-31'),
      );

      expect(result).toEqual([]);
    });

    it('descarta linha em formato inesperado sem perder as válidas', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token');
      client.fetchAdvertiserId.mockResolvedValue('adv-1');
      client.fetchAdsItemMetrics.mockResolvedValue([
        { item_id: 'MLB1', date: '2026-07-15', cost: 10 },
        { sem_id: true }, // inválida
        { item_id: 'MLB2', date: '2026-07-15', cost: 20 },
      ]);

      const result = await provider.fetchAdsItemMetrics(
        { marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' },
        new Date('2026-07-01'),
        new Date('2026-07-31'),
      );

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.externalItemId)).toEqual(['MLB1', 'MLB2']);
    });
  });

  describe('ensureValidCredentials / listTenantIdsToSync', () => {
    it('delega para MercadoLivreConnectionService (mesma conexão OAuth2 de Orders/Fee Rules)', async () => {
      const { provider, connection } = buildProvider();
      connection.listActiveTenantIds.mockResolvedValue(['tenant-1', 'tenant-2']);

      await provider.ensureValidCredentials('tenant-1');
      const tenants = await provider.listTenantIdsToSync();

      expect(connection.getValidAccessToken).toHaveBeenCalledWith('tenant-1');
      expect(tenants).toEqual(['tenant-1', 'tenant-2']);
    });
  });
});
