import { NotFoundException } from '@nestjs/common';
import { MercadoLivreOrderProvider } from './mercado-livre-order.provider';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

describe('MercadoLivreOrderProvider (Sprint 22 — OAuth2 real)', () => {
  function buildProvider() {
    const client = { fetchOrders: jest.fn(), fetchShipmentStatus: jest.fn() } as unknown as jest.Mocked<MercadoLivreApiClient>;
    const connection = {
      listActiveTenantIds: jest.fn(),
      getValidAccessToken: jest.fn(),
      getSellerId: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;
    const provider = new MercadoLivreOrderProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara a capacidade ORDERS e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('MERCADO_LIVRE');
    expect(provider.capabilities).toContain('ORDERS');
  });

  it('healthCheck reporta UP (saúde real é por tenant, não global)', async () => {
    const { provider } = buildProvider();
    await expect(provider.healthCheck()).resolves.toEqual({ status: 'UP' });
  });

  it('listTenantIdsToSync delega para MercadoLivreConnectionService.listActiveTenantIds', async () => {
    const { provider, connection } = buildProvider();
    connection.listActiveTenantIds.mockResolvedValue(['tenant-1', 'tenant-2']);

    await expect(provider.listTenantIdsToSync()).resolves.toEqual(['tenant-1', 'tenant-2']);
  });

  it('ensureValidCredentials delega para getValidAccessToken (propaga NotFoundException se não houver conexão)', async () => {
    const { provider, connection } = buildProvider();
    connection.getValidAccessToken.mockRejectedValue(new NotFoundException('sem conexão'));

    await expect(provider.ensureValidCredentials('tenant-1')).rejects.toThrow(NotFoundException);
  });

  it('fetchOrders sem tenantId: devolve [] sem chamar nada (pedido é sempre por vendedor)', async () => {
    const { provider, connection, client } = buildProvider();

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE' });

    expect(result).toEqual([]);
    expect(connection.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchOrders).not.toHaveBeenCalled();
  });

  it('fetchOrders: busca token válido (renovado se necessário) + sellerId, chama o client e normaliza', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([
      {
        id: 123,
        status: 'paid',
        total_amount: 100,
        currency_id: 'BRL',
        date_created: '2026-07-01T10:00:00.000-04:00',
        shipping: { id: 555 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 100 }],
      },
    ]);
    // Bug de produção (24/07/2026): /shipments/{id} ainda não tem status
    // disponível (pedido recém-pago) — cai no fallback EM_ABERTO/PREPARANDO,
    // nunca assume "enviado" sem confirmação real.
    client.fetchShipmentStatus.mockResolvedValue(null);

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(connection.getValidAccessToken).toHaveBeenCalledWith('tenant-1');
    expect(connection.getSellerId).toHaveBeenCalledWith('tenant-1');
    expect(client.fetchOrders).toHaveBeenCalledWith('999', 'access-token-valido', undefined, 'date_last_updated');
    // Pedido pago com shipping.id presente — consulta o status real do envio.
    expect(client.fetchShipmentStatus).toHaveBeenCalledWith('555', 'access-token-valido');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ externalOrderId: '123', status: 'PREPARANDO_ENVIO' });
  });

  it('fetchOrders: consulta o envio real e reflete ENVIADO/ENTREGUE quando o Mercado Livre confirma (bug corrigido 24/07/2026)', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([
      {
        id: 111,
        status: 'paid',
        total_amount: 50,
        currency_id: 'BRL',
        date_created: '2026-06-01T10:00:00.000-04:00',
        shipping: { id: 1 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 50 }],
      },
      {
        id: 222,
        status: 'paid',
        total_amount: 60,
        currency_id: 'BRL',
        date_created: '2026-06-02T10:00:00.000-04:00',
        shipping: { id: 2 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 60 }],
      },
    ]);
    client.fetchShipmentStatus.mockImplementation(async (shipmentId: string) =>
      shipmentId === '1' ? { status: 'delivered', substatus: null } : { status: 'shipped', substatus: null },
    );

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(result).toHaveLength(2);
    expect(result.find((o) => o.externalOrderId === '111')).toMatchObject({ status: 'ENTREGUE' });
    expect(result.find((o) => o.externalOrderId === '222')).toMatchObject({ status: 'ENVIADO' });
  });

  it('fetchOrders: NÃO consulta o envio para pedido ainda não pago (economiza chamada de API)', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([
      {
        id: 333,
        status: 'payment_in_process',
        total_amount: 30,
        currency_id: 'BRL',
        date_created: '2026-07-20T10:00:00.000-04:00',
        shipping: { id: 9 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 30 }],
      },
    ]);

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ status: 'EM_ABERTO' });
  });

  it('fetchOrders: token válido mas sellerId não resolvido (defesa em profundidade) — devolve [] sem chamar o client', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue(null);

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(result).toEqual([]);
    expect(client.fetchOrders).not.toHaveBeenCalled();
  });

  it('fetchOrders propaga a exceção quando não há conexão ativa (getValidAccessToken lança)', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockRejectedValue(new NotFoundException('sem conexão'));

    await expect(provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' })).rejects.toThrow(NotFoundException);
    expect(client.fetchOrders).not.toHaveBeenCalled();
  });
});
