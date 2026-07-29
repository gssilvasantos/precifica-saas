import { NotFoundException } from '@nestjs/common';
import { ShopeeOrderProvider } from './shopee-order.provider';
import { ShopeeApiClient } from './shopee-api-client';
import { ShopeeConnectionService } from '../../../application/shopee-connection.service';

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('ShopeeOrderProvider (segunda capacidade da Shopee — ORDERS, depois do handshake real confirmado)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, SHOPEE_PARTNER_ID: 'partner-id-teste', SHOPEE_PARTNER_KEY: 'partner-key-teste' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  function buildProvider() {
    const client = {
      fetchOrderList: jest.fn(),
      fetchOrderDetail: jest.fn(),
      createShippingDocument: jest.fn(),
      getShippingDocumentResult: jest.fn(),
      buildDownloadShippingDocumentPath: jest.fn(),
    } as unknown as jest.Mocked<ShopeeApiClient>;
    const connection = {
      listActiveTenantIds: jest.fn(),
      getValidAccessToken: jest.fn(),
      getShopId: jest.fn(),
    } as unknown as jest.Mocked<ShopeeConnectionService>;
    const provider = new ShopeeOrderProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara as capacidades ORDERS e SHIPPING_LABEL e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('SHOPEE');
    expect(provider.capabilities).toContain('ORDERS');
    expect(provider.capabilities).toContain('SHIPPING_LABEL');
    expect(provider.code).toBe('SHOPEE_ORDERS');
  });

  it('healthCheck reporta UP (saúde real é por tenant, não global)', async () => {
    const { provider } = buildProvider();
    await expect(provider.healthCheck()).resolves.toEqual({ status: 'UP' });
  });

  it('listTenantIdsToSync delega para ShopeeConnectionService.listActiveTenantIds', async () => {
    const { provider, connection } = buildProvider();
    connection.listActiveTenantIds.mockResolvedValue(['tenant-1']);

    await expect(provider.listTenantIdsToSync()).resolves.toEqual(['tenant-1']);
  });

  it('ensureValidCredentials delega para getValidAccessToken (propaga NotFoundException se não houver conexão)', async () => {
    const { provider, connection } = buildProvider();
    connection.getValidAccessToken.mockRejectedValue(new NotFoundException('sem conexão'));

    await expect(provider.ensureValidCredentials('tenant-1')).rejects.toThrow(NotFoundException);
  });

  it('fetchOrders sem tenantId: devolve [] sem chamar nada (pedido é sempre por loja)', async () => {
    const { provider, connection, client } = buildProvider();

    const result = await provider.fetchOrders({ marketplaceCode: 'SHOPEE' });

    expect(result).toEqual([]);
    expect(connection.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchOrderList).not.toHaveBeenCalled();
  });

  it('fetchOrders: token válido mas shopId não resolvido (defesa em profundidade) — devolve [] sem chamar o client', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getShopId.mockResolvedValue(null);

    const result = await provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' });

    expect(result).toEqual([]);
    expect(client.fetchOrderList).not.toHaveBeenCalled();
  });

  it('fetchOrders propaga a exceção quando não há conexão ativa (getValidAccessToken lança)', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockRejectedValue(new NotFoundException('sem conexão'));

    await expect(provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' })).rejects.toThrow(NotFoundException);
    expect(client.fetchOrderList).not.toHaveBeenCalled();
  });

  it('fetchOrders: nenhum order_sn encontrado — devolve [] sem chamar fetchOrderDetail', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getShopId.mockResolvedValue('shop-1');
    client.fetchOrderList.mockResolvedValue([]);

    const result = await provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1', since: daysAgo(7) });

    expect(result).toEqual([]);
    expect(client.fetchOrderDetail).not.toHaveBeenCalled();
  });

  it('fetchOrders: busca lista + detalhe e normaliza os pedidos', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getShopId.mockResolvedValue('shop-1');
    client.fetchOrderList.mockResolvedValue(['ORDER-1']);
    client.fetchOrderDetail.mockResolvedValue([
      {
        order_sn: 'ORDER-1',
        order_status: 'READY_TO_SHIP',
        total_amount: 100,
        currency: 'BRL',
        create_time: Math.floor(daysAgo(3).getTime() / 1000),
        pay_time: Math.floor(daysAgo(2).getTime() / 1000),
        item_list: [{ model_sku: 'SKU-1', item_name: 'Produto Teste', model_quantity_purchased: 2, model_discounted_price: 50 }],
      },
    ]);

    const result = await provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1', since: daysAgo(7) });

    expect(client.fetchOrderList).toHaveBeenCalledWith('partner-id-teste', 'partner-key-teste', 'shop-1', 'access-token-valido', expect.any(Date), 'update_time');
    expect(client.fetchOrderDetail).toHaveBeenCalledWith('partner-id-teste', 'partner-key-teste', 'shop-1', 'access-token-valido', ['ORDER-1']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ externalOrderId: 'ORDER-1', status: 'PREPARANDO_ENVIO', totalAmount: 100 });
    expect(result[0].items).toEqual([{ externalSku: 'SKU-1', productName: 'Produto Teste', quantity: 2, unitPrice: 50, totalPrice: 100 }]);
  });

  it('fetchOrders: backfill (isFirstSync) usa create_time; incremental usa update_time', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getShopId.mockResolvedValue('shop-1');
    client.fetchOrderList.mockResolvedValue([]);

    await provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1', since: daysAgo(90), isFirstSync: true });
    expect(client.fetchOrderList).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'shop-1', 'access-token-valido', expect.any(Date), 'create_time');

    await provider.fetchOrders({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1', since: daysAgo(7), isFirstSync: false });
    expect(client.fetchOrderList).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'shop-1', 'access-token-valido', expect.any(Date), 'update_time');
  });

  describe('getShippingLabel (Fase 5, Expedição em lote)', () => {
    it('sem tenantId: devolve success false sem chamar nada', async () => {
      const { provider, client } = buildProvider();
      const result = await provider.getShippingLabel({ marketplaceCode: 'SHOPEE' }, 'ORDER-1');
      expect(result.success).toBe(false);
      expect(client.createShippingDocument).not.toHaveBeenCalled();
    });

    it('sem loja conectada: devolve success false com mensagem explicativa', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue(null);

      const result = await provider.getShippingLabel({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, 'ORDER-1');

      expect(result.success).toBe(false);
      expect(client.createShippingDocument).not.toHaveBeenCalled();
    });

    it('documento ainda não pronto: devolve success false sem lançar', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.createShippingDocument.mockResolvedValue(undefined);
      client.getShippingDocumentResult.mockResolvedValue({ status: 'PROCESSING' });

      const result = await provider.getShippingLabel({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, 'ORDER-1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/processing/);
    });

    it('documento pronto (READY): devolve success true com o path de download', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.createShippingDocument.mockResolvedValue(undefined);
      client.getShippingDocumentResult.mockResolvedValue({ status: 'READY' });
      client.buildDownloadShippingDocumentPath.mockReturnValue('/api/v2/logistics/download_shipping_document');

      const result = await provider.getShippingLabel({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, 'ORDER-1');

      expect(result).toEqual({ success: true, labelUrl: '/api/v2/logistics/download_shipping_document' });
    });

    it('falha do client (ex.: HTTP não-ok): devolve success false com a mensagem do erro, nunca lança', async () => {
      const { provider, client, connection } = buildProvider();
      connection.getValidAccessToken.mockResolvedValue('token-valido');
      connection.getShopId.mockResolvedValue('shop-1');
      client.createShippingDocument.mockRejectedValue(new Error('Shopee retornou erro'));

      const result = await provider.getShippingLabel({ marketplaceCode: 'SHOPEE', tenantId: 'tenant-1' }, 'ORDER-1');

      expect(result).toEqual({ success: false, message: 'Shopee retornou erro' });
    });
  });
});
