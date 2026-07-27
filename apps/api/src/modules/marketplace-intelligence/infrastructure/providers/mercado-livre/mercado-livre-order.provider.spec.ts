import { NotFoundException } from '@nestjs/common';
import { MercadoLivreOrderProvider } from './mercado-livre-order.provider';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// Datas relativas a "agora" (nunca absolutas) — evita testes que quebram
// sozinhos com o tempo.
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('MercadoLivreOrderProvider (Reestruturação do sync ML, 25-26/07/2026 — fast path sem enriquecimento inline)', () => {
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

  it('fetchOrders: busca token válido (renovado se necessário) + sellerId, chama o client e normaliza SEM consultar envio', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([
      {
        id: 123,
        status: 'paid',
        total_amount: 100,
        currency_id: 'BRL',
        date_created: daysAgo(5),
        shipping: { id: 555 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 100 }],
      },
    ]);

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(connection.getValidAccessToken).toHaveBeenCalledWith('tenant-1');
    expect(connection.getSellerId).toHaveBeenCalledWith('tenant-1');
    expect(client.fetchOrders).toHaveBeenCalledWith('999', 'access-token-valido', undefined, 'date_last_updated');
    // Reestruturação do sync (25-26/07/2026): fetchOrders NUNCA mais chama
    // fetchShipmentStatus — isso virou responsabilidade exclusiva de
    // MercadoLivreShipmentEnrichmentJob (módulo orders).
    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    // Sem confirmação de envio, cai no fallback de mapMercadoLivreStatus —
    // pedido pago sempre normaliza para PREPARANDO_ENVIO até o job de
    // enriquecimento confirmar o status real.
    expect(result[0]).toMatchObject({ externalOrderId: '123', status: 'PREPARANDO_ENVIO' });
  });

  it('fetchOrders: pedido ainda não pago normaliza para EM_ABERTO (sem qualquer consulta extra)', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([
      {
        id: 333,
        status: 'payment_in_process',
        total_amount: 30,
        currency_id: 'BRL',
        date_created: daysAgo(2),
        shipping: { id: 9 },
        order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 30 }],
      },
    ]);

    const result = await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(client.fetchShipmentStatus).not.toHaveBeenCalled();
    expect(result[0]).toMatchObject({ status: 'EM_ABERTO' });
  });

  it('fetchOrders: backfill (isFirstSync) usa date_created; incremental usa date_last_updated', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('access-token-valido');
    connection.getSellerId.mockResolvedValue('999');
    client.fetchOrders.mockResolvedValue([]);

    await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1', isFirstSync: true });
    expect(client.fetchOrders).toHaveBeenCalledWith('999', 'access-token-valido', undefined, 'date_created');

    await provider.fetchOrders({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1', isFirstSync: false });
    expect(client.fetchOrders).toHaveBeenCalledWith('999', 'access-token-valido', undefined, 'date_last_updated');
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
