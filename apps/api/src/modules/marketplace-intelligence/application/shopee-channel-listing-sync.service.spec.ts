import { ShopeeChannelListingSyncService, SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE } from './shopee-channel-listing-sync.service';
import { ShopeeConnectionService } from './shopee-connection.service';
import { ShopeeApiClient, ShopeeItemBaseInfo } from '../infrastructure/providers/shopee/shopee-api-client';
import { ChannelListingWriter } from '../../../shared/contracts/channel-listing-reader.port';

function buildItem(overrides: Partial<ShopeeItemBaseInfo> = {}): ShopeeItemBaseInfo {
  return { id: '111', title: 'Item de teste', skuCode: 'SKU-1', price: 99.9, status: 'NORMAL', ...overrides };
}

describe('ShopeeChannelListingSyncService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SHOPEE_PARTNER_ID: '1239393', SHOPEE_PARTNER_KEY: 'partner-key-de-teste' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function buildService() {
    const connections = {
      listActiveTenantIds: jest.fn(),
      getShopId: jest.fn(),
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<ShopeeConnectionService>;

    const listings = { upsert: jest.fn() } as unknown as jest.Mocked<ChannelListingWriter>;

    const syncLogs = { start: jest.fn().mockResolvedValue('log-1'), finish: jest.fn() };
    const health = { recordSuccess: jest.fn(), recordFailure: jest.fn() };

    const client = {
      fetchItemList: jest.fn(),
      fetchItemBaseInfo: jest.fn(),
    } as unknown as jest.Mocked<ShopeeApiClient>;

    const service = new ShopeeChannelListingSyncService(connections, listings, syncLogs as never, health as never, client);

    return { service, connections, listings, syncLogs, health, client };
  }

  it('sem conexão ativa (shopId null): devolve success false, registra falha, nunca chama a API de itens', async () => {
    const { service, connections, health, client } = buildService();
    connections.getShopId.mockResolvedValue(null);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/inativa ou sem shopId/i);
    expect(health.recordFailure).toHaveBeenCalledWith(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE, expect.any(String));
    expect(client.fetchItemList).not.toHaveBeenCalled();
  });

  it('sincroniza anúncios com SKU: faz upsert por item, com URL construída a partir de shopId+itemId', async () => {
    const { service, connections, listings, client, health } = buildService();
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchItemList.mockResolvedValue(['111', '222']);
    client.fetchItemBaseInfo.mockResolvedValue([
      buildItem({ id: '111', skuCode: 'SKU-1', price: 99.9 }),
      buildItem({ id: '222', skuCode: 'SKU-2', price: 50 }),
    ]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(client.fetchItemList).toHaveBeenCalledWith('1239393', 'partner-key-de-teste', '555', 'token-valido');
    expect(listings.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      skuCode: 'SKU-1',
      channelCode: 'SHOPEE',
      externalId: '111',
      currentPrice: 99.9,
      url: 'https://shopee.com.br/product/555/111',
    });
    expect(listings.upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      skuCode: 'SKU-2',
      channelCode: 'SHOPEE',
      externalId: '222',
      currentPrice: 50,
      url: 'https://shopee.com.br/product/555/222',
    });
    expect(health.recordSuccess).toHaveBeenCalledWith(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE);
  });

  it('anúncio sem item_sku: é ignorado (sem upsert), não derruba o restante do lote', async () => {
    const { service, listings, connections, client } = buildService();
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchItemList.mockResolvedValue(['111', '999']);
    client.fetchItemBaseInfo.mockResolvedValue([buildItem({ id: '999', skuCode: null }), buildItem({ id: '111', skuCode: 'SKU-1' })]);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(listings.upsert).toHaveBeenCalledTimes(1);
    expect(listings.upsert).toHaveBeenCalledWith(expect.objectContaining({ externalId: '111' }));
  });

  it('upsert de um item falha: loga e segue para os demais, ainda success true', async () => {
    const { service, listings, connections, client } = buildService();
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchItemList.mockResolvedValue(['111', '222']);
    client.fetchItemBaseInfo.mockResolvedValue([buildItem({ id: '111', skuCode: 'SKU-1' }), buildItem({ id: '222', skuCode: 'SKU-2' })]);
    listings.upsert.mockRejectedValueOnce(new Error('violação de unicidade')).mockResolvedValueOnce(undefined);

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(true);
    expect(listings.upsert).toHaveBeenCalledTimes(2);
  });

  it('falha ao buscar itens na API: devolve success false, registra falha de saúde e no log de sync', async () => {
    const { service, connections, client, health, syncLogs } = buildService();
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchItemList.mockRejectedValue(new Error('Shopee retornou HTTP 500'));

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Shopee retornou HTTP 500');
    expect(health.recordFailure).toHaveBeenCalledWith(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE, 'Shopee retornou HTTP 500');
    expect(syncLogs.finish).toHaveBeenCalledWith('log-1', expect.objectContaining({ status: 'FAILED' }));
  });

  it('SHOPEE_PARTNER_ID ausente: devolve success false sem tentar chamar a API', async () => {
    delete process.env.SHOPEE_PARTNER_ID;
    const { service, connections, client, health } = buildService();
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');

    const result = await service.syncTenant('tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SHOPEE_PARTNER_ID/);
    expect(client.fetchItemList).not.toHaveBeenCalled();
    expect(health.recordFailure).toHaveBeenCalled();
  });

  it('syncAllTenants: sincroniza todos os tenants ativos, um a um', async () => {
    const { service, connections, client } = buildService();
    connections.listActiveTenantIds.mockResolvedValue(['tenant-1', 'tenant-2']);
    connections.getShopId.mockResolvedValue('555');
    connections.getValidAccessToken.mockResolvedValue('token-valido');
    client.fetchItemList.mockResolvedValue([]);
    client.fetchItemBaseInfo.mockResolvedValue([]);

    await service.syncAllTenants();

    expect(connections.getShopId).toHaveBeenCalledWith('tenant-1');
    expect(connections.getShopId).toHaveBeenCalledWith('tenant-2');
  });
});
