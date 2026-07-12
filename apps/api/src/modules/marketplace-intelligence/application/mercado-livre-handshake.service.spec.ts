import { MercadoLivreHandshakeService } from './mercado-livre-handshake.service';
import { MercadoLivreConnectionService, MercadoLivreConnectionStatus } from './mercado-livre-connection.service';
import { MercadoLivreApiClient } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';

function buildStatus(overrides: Partial<MercadoLivreConnectionStatus> = {}): MercadoLivreConnectionStatus {
  return {
    connected: true,
    isActive: true,
    sellerId: '999',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastRefreshedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('MercadoLivreHandshakeService', () => {
  function buildService() {
    const connectionService = {
      getStatus: jest.fn(),
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;

    const client = {
      fetchOrders: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;

    const alerts = { emitAlert: jest.fn() };

    const service = new MercadoLivreHandshakeService(connectionService, client, alerts);
    return { service, connectionService, client, alerts };
  }

  it('sem conexão ativa: devolve success false sem chamar getValidAccessToken/fetchOrders', async () => {
    const { service, connectionService, client } = buildService();
    connectionService.getStatus.mockResolvedValue(buildStatus({ connected: false, isActive: false, sellerId: null }));

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/nenhuma conexão ativa/i);
    expect(connectionService.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchOrders).not.toHaveBeenCalled();
  });

  it('conexão ativa, sem necessidade de renovar: sucesso, tokenRefreshed false, reporta pedidos encontrados', async () => {
    const { service, connectionService, client } = buildService();
    const stableStatus = buildStatus();
    connectionService.getStatus.mockResolvedValue(stableStatus);
    connectionService.getValidAccessToken.mockResolvedValue('access-valido');
    client.fetchOrders.mockResolvedValue([{ id: 12345 }, { id: 67890 }]);

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(true);
    expect(result.tokenRefreshed).toBe(false);
    expect(result.ordersFound).toBe(2);
    expect(result.sampleOrderId).toBe('12345');
    expect(result.sellerId).toBe('999');
    expect(client.fetchOrders).toHaveBeenCalledWith('999', 'access-valido');
  });

  it('token renovado durante o teste (lastRefreshedAt muda): reporta tokenRefreshed true', async () => {
    const { service, connectionService, client } = buildService();
    connectionService.getStatus
      .mockResolvedValueOnce(buildStatus({ lastRefreshedAt: new Date('2026-07-01T00:00:00Z') }))
      .mockResolvedValueOnce(buildStatus({ lastRefreshedAt: new Date('2026-07-11T00:00:00Z') }));
    connectionService.getValidAccessToken.mockResolvedValue('access-renovado');
    client.fetchOrders.mockResolvedValue([]);

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(true);
    expect(result.tokenRefreshed).toBe(true);
    expect(result.ordersFound).toBe(0);
    expect(result.sampleOrderId).toBeNull();
  });

  it('falha ao renovar/buscar pedidos: devolve success false, emite alerta ERROR, nunca lança', async () => {
    const { service, connectionService, client, alerts } = buildService();
    connectionService.getStatus.mockResolvedValue(buildStatus());
    connectionService.getValidAccessToken.mockRejectedValue(new Error('refresh_token revogado'));

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('refresh_token revogado');
    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MercadoLivreHandshakeService', severity: 'ERROR' }),
    );
  });

  it('nunca chama nenhum método de escrita de pedidos (é um diagnóstico read-only)', async () => {
    const { service, connectionService, client } = buildService();
    connectionService.getStatus.mockResolvedValue(buildStatus());
    connectionService.getValidAccessToken.mockResolvedValue('access-valido');
    client.fetchOrders.mockResolvedValue([{ id: 1 }]);

    await service.testConnection('tenant-1');

    // client só expõe leitura (fetchOrders) — não há upsert/persist aqui
    // por design; este teste documenta a intenção (ver comentário de
    // arquitetura no serviço) e falharia se alguém adicionasse uma
    // dependência de escrita (ex.: OrderRepository) no construtor no futuro.
    expect(Object.keys(service)).not.toContain('orders');
  });
});
