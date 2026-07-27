import { ShopeeHandshakeService } from './shopee-handshake.service';
import { ShopeeConnectionService, ShopeeConnectionStatus } from './shopee-connection.service';
import { ShopeeApiClient } from '../infrastructure/providers/shopee/shopee-api-client';

function buildStatus(overrides: Partial<ShopeeConnectionStatus> = {}): ShopeeConnectionStatus {
  return {
    connected: true,
    isActive: true,
    shopId: '555',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    lastRefreshedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('ShopeeHandshakeService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, SHOPEE_PARTNER_ID: '1239393', SHOPEE_PARTNER_KEY: 'partner-key-secreta' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function buildService() {
    const connectionService = {
      getStatus: jest.fn(),
      getValidAccessToken: jest.fn(),
    } as unknown as jest.Mocked<ShopeeConnectionService>;

    const client = {
      fetchShopInfo: jest.fn(),
    } as unknown as jest.Mocked<ShopeeApiClient>;

    const alerts = { emitAlert: jest.fn() };

    const service = new ShopeeHandshakeService(connectionService, client, alerts);
    return { service, connectionService, client, alerts };
  }

  it('sem conexão ativa: devolve success false sem chamar getValidAccessToken/fetchShopInfo', async () => {
    const { service, connectionService, client } = buildService();
    connectionService.getStatus.mockResolvedValue(buildStatus({ connected: false, isActive: false, shopId: null }));

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/nenhuma conexão ativa/i);
    expect(connectionService.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchShopInfo).not.toHaveBeenCalled();
  });

  it('conexão ativa, sem necessidade de renovar: sucesso, tokenRefreshed false, reporta nome/status da loja', async () => {
    const { service, connectionService, client } = buildService();
    const stableStatus = buildStatus();
    connectionService.getStatus.mockResolvedValue(stableStatus);
    connectionService.getValidAccessToken.mockResolvedValue('access-valido');
    client.fetchShopInfo.mockResolvedValue({ shop_name: 'Loja Kyneti Teste', status: 'NORMAL' });

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(true);
    expect(result.tokenRefreshed).toBe(false);
    expect(result.shopId).toBe('555');
    expect(result.shopName).toBe('Loja Kyneti Teste');
    expect(result.shopStatus).toBe('NORMAL');
    expect(client.fetchShopInfo).toHaveBeenCalledWith('1239393', 'partner-key-secreta', '555', 'access-valido');
  });

  it('token renovado durante o teste (lastRefreshedAt muda): reporta tokenRefreshed true', async () => {
    const { service, connectionService, client } = buildService();
    connectionService.getStatus
      .mockResolvedValueOnce(buildStatus({ lastRefreshedAt: new Date('2026-07-01T00:00:00Z') }))
      .mockResolvedValueOnce(buildStatus({ lastRefreshedAt: new Date('2026-07-11T00:00:00Z') }));
    connectionService.getValidAccessToken.mockResolvedValue('access-renovado');
    client.fetchShopInfo.mockResolvedValue({ shop_name: 'Loja Kyneti Teste', status: 'NORMAL' });

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(true);
    expect(result.tokenRefreshed).toBe(true);
  });

  it('falha ao renovar/consultar a loja: devolve success false, emite alerta ERROR, nunca lança', async () => {
    const { service, connectionService, client, alerts } = buildService();
    connectionService.getStatus.mockResolvedValue(buildStatus());
    connectionService.getValidAccessToken.mockRejectedValue(new Error('refresh_token revogado'));

    const result = await service.testConnection('tenant-1');

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('refresh_token revogado');
    expect(alerts.emitAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ShopeeHandshakeService', severity: 'ERROR' }),
    );
  });
});
