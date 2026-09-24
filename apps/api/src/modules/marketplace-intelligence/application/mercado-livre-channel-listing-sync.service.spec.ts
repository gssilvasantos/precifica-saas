import { MercadoLivreChannelListingSyncService, MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE } from './mercado-livre-channel-listing-sync.service';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreApiClient, MlSellerItem } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';
import { ChannelListingWriter } from '../../../shared/contracts/channel-listing-reader.port';
import { CHANNEL_LISTING_EVENTS } from '../domain/channel-listing-events';

function buildItem(overrides: Partial<MlSellerItem> = {}): MlSellerItem {
  return { id: 'MLB111', price: 99.9, permalink: 'https://produto.mercadolivre.com.br/MLB111', skuCode: 'SKU-1', title: 'Item de teste', ...overrides };
}

describe('MercadoLivreChannelListingSyncService', () => {
  function buildService() {
    const connections = {
      listActiveTenantIds: jest.fn(),
      getSellerId: jest.fn(),
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;

    const listings = { upsert: jest.fn() } as unknown as jest.Mocked<ChannelListingWriter>;

    const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn() };
    const health = { recordSuccess: jest.fn(), recordFailure: jest.fn() };

    const client = {
      fetchSellerItemIds: jest.fn(),
      fetchItemsDetails: jest.fn(),
      fetchOrderSellerIdSample: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;

    const events = { emit: jest.fn() };

    const service = new MercadoLivreChannelListingSyncService(
      connections,
      listings,
      syncLogs as never,
      health as never,
      client,
      events as never,
    );

    return { service, connections, listings, syncLogs, health, client, events };
  }

  it('sem conexão ativa (sellerId null): devolve success false, registra falha, nunca chama a API de itens', async () => {
    const { service, connections, health, client } = buildService();
    connections.getSellerId.mockResolvedValue(null);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inativa ou sem sellerId/i);
    expect(health.recordFailure).toHaveBeenCalledWith(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE, expect.any(String));
    expect(client.fetchSellerItemIds).not.toHaveBeenCalled();
  });

  it('sincroniza anúncios com SKU: faz upsert por item, emite o evento com a lista sincronizada', async () => {
    const { service, connections, listings, client, events, health } = buildService();
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue(['MLB111', 'MLB222']);
    client.fetchItemsDetails.mockResolvedValue([
      buildItem({ id: 'MLB111', skuCode: 'SKU-1' }),
      buildItem({ id: 'MLB222', skuCode: 'SKU-2', price: 50, permalink: null }),
    ]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(listings.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      skuCode: 'SKU-1',
      channelCode: 'MERCADO_LIVRE',
      externalId: 'MLB111',
      currentPrice: 99.9,
      url: 'https://produto.mercadolivre.com.br/MLB111',
    });
    expect(listings.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      skuCode: 'SKU-2',
      channelCode: 'MERCADO_LIVRE',
      externalId: 'MLB222',
      currentPrice: 50,
      url: null,
    });
    expect(events.emit).toHaveBeenCalledWith(CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED, {
      tenantId: 'tenant-1',
      listings: [
        { skuCode: 'SKU-1', externalId: 'MLB111' },
        { skuCode: 'SKU-2', externalId: 'MLB222' },
      ],
    });
    expect(health.recordSuccess).toHaveBeenCalledWith(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE);
  });

  it('anúncio sem SKU: é ignorado (sem upsert), não derruba o restante do lote', async () => {
    const { service, listings, events, connections, client } = buildService();
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue(['MLB111', 'MLB999']);
    client.fetchItemsDetails.mockResolvedValue([buildItem({ id: 'MLB999', skuCode: null }), buildItem({ id: 'MLB111', skuCode: 'SKU-1' })]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(listings.upsert).toHaveBeenCalledTimes(1);
    expect(listings.upsert).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'MLB111' }));
    expect(events.emit).toHaveBeenCalledWith(
      CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED,
      expect.objectContaining({ listings: [{ skuCode: 'SKU-1', externalId: 'MLB111' }] }),
    );
  });

  it('nenhum anúncio vinculável (todos sem SKU): não emite o evento', async () => {
    const { service, events, connections, client } = buildService();
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue(['MLB999']);
    client.fetchItemsDetails.mockResolvedValue([buildItem({ id: 'MLB999', skuCode: null })]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('fetchSellerItemIds devolve 0 anúncios: tenta sellerId alternativo (extraído de pedido real) e sincroniza com ele', async () => {
    const { service, listings, events, connections, client } = buildService();
    connections.getSellerId.mockResolvedValue('50756967');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValueOnce([]).mockResolvedValueOnce(['MLB111']);
    client.fetchOrderSellerIdSample.mockResolvedValue('2341287049');
    client.fetchItemsDetails.mockResolvedValue([buildItem({ id: 'MLB111', skuCode: 'SKU-1' })]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(client.fetchOrderSellerIdSample).toHaveBeenCalledWith('50756967', 'token-valido');
    expect(client.fetchSellerItemIds).toHaveBeenNthCalledWith(1, '50756967', 'token-valido');
    expect(client.fetchSellerItemIds).toHaveBeenNthCalledWith(2, '2341287049', 'token-valido');
    expect(listings.upsert).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'MLB111', skuCode: 'SKU-1' }));
    expect(events.emit).toHaveBeenCalledWith(CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED, expect.objectContaining({ tenantId: 'tenant-1' }));
  });

  it('fetchSellerItemIds devolve 0 anúncios e não há pedido real para extrair sellerId alternativo: mantém 0 candidatos, sem erro', async () => {
    const { service, connections, client, events } = buildService();
    connections.getSellerId.mockResolvedValue('50756967');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue([]);
    client.fetchOrderSellerIdSample.mockResolvedValue(null);
    client.fetchItemsDetails.mockResolvedValue([]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(client.fetchSellerItemIds).toHaveBeenCalledTimes(1);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('upsert de um item falha: loga e segue para os demais, ainda success true', async () => {
    const { service, listings, connections, client } = buildService();
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue(['MLB111', 'MLB222']);
    client.fetchItemsDetails.mockResolvedValue([
      buildItem({ id: 'MLB111', skuCode: 'SKU-1' }),
      buildItem({ id: 'MLB222', skuCode: 'SKU-2' }),
    ]);
    listings.upsert.mockRejectedValueOnce(new Error('violação de unicidade')).mockResolvedValueOnce(undefined);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(listings.upsert).toHaveBeenCalledTimes(2);
  });

  it('falha ao buscar itens na API: devolve success false, registra falha de saúde e no log de sync', async () => {
    const { service, connections, client, health, syncLogs } = buildService();
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockRejectedValue(new Error('Mercado Livre retornou HTTP 500'));

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Mercado Livre retornou HTTP 500');
    expect(health.recordFailure).toHaveBeenCalledWith(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE, 'Mercado Livre retornou HTTP 500');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED' }));
  });

  it('syncAllTenants: sincroniza todos os tenants ativos, um a um', async () => {
    const { service, connections, client } = buildService();
    connections.listActiveTenantIds.mockResolvedValue(['tenant-1', 'tenant-2']);
    connections.getSellerId.mockResolvedValue('999');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchSellerItemIds.mockResolvedValue([]);
    client.fetchItemsDetails.mockResolvedValue([]);

    await service.syncAllTenants();

    expect(connections.getSellerId).toHaveBeenCalledWith('tenant-1');
    expect(connections.getSellerId).toHaveBeenCalledWith('tenant-2');
  });
});
