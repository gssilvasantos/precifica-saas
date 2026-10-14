import { MercadoLivreChannelPaymentProvider } from './mercado-livre-channel-payment.provider';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

describe('MercadoLivreChannelPaymentProvider', () => {
  function buildProvider() {
    const client = {
      fetchSettledPayments: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;
    const connection = {
      listActiveTenantIds: jest.fn(),
      getValidAccessToken: jest.fn(),
      getSellerId: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreConnectionService>;
    const provider = new MercadoLivreChannelPaymentProvider(client, connection);
    return { provider, client, connection };
  }

  it('declara a capacidade PAYMENT_RECONCILIATION e o marketplaceCode correto', () => {
    const { provider } = buildProvider();
    expect(provider.marketplaceCode).toBe('MERCADO_LIVRE');
    expect(provider.capabilities).toContain('PAYMENT_RECONCILIATION');
  });

  it('healthCheck reporta UP (saúde real é por tenant, não global)', async () => {
    const { provider } = buildProvider();
    await expect(provider.healthCheck()).resolves.toEqual({ status: 'UP' });
  });

  it('listTenantIdsToSync delega para MercadoLivreConnectionService.listActiveTenantIds', async () => {
    const { provider, connection } = buildProvider();
    connection.listActiveTenantIds.mockResolvedValue(['tenant-1']);

    await expect(provider.listTenantIdsToSync()).resolves.toEqual(['tenant-1']);
  });

  it('fetchSettledPayments sem tenantId: devolve [] sem chamar nada', async () => {
    const { provider, connection, client } = buildProvider();

    const result = await provider.fetchSettledPayments({ marketplaceCode: 'MERCADO_LIVRE', since: new Date() });

    expect(result).toEqual([]);
    expect(connection.getValidAccessToken).not.toHaveBeenCalled();
    expect(client.fetchSettledPayments).not.toHaveBeenCalled();
  });

  it('fetchSettledPayments sem since: devolve [] sem chamar nada (nunca busca o histórico inteiro)', async () => {
    const { provider, client } = buildProvider();

    const result = await provider.fetchSettledPayments({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1' });

    expect(result).toEqual([]);
    expect(client.fetchSettledPayments).not.toHaveBeenCalled();
  });

  it('tenant sem sellerId resolvido: devolve [] sem chamar o client', async () => {
    const { provider, connection, client } = buildProvider();
    connection.getValidAccessToken.mockResolvedValue('token-123');
    connection.getSellerId.mockResolvedValue(null);

    const result = await provider.fetchSettledPayments({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1', since: new Date() });

    expect(result).toEqual([]);
    expect(client.fetchSettledPayments).not.toHaveBeenCalled();
  });

  it('busca o token válido e o sellerId, chama o client e mapeia o resultado para RawSettlementEntry', async () => {
    const { provider, connection, client } = buildProvider();
    const since = new Date('2026-09-01');
    connection.getValidAccessToken.mockResolvedValue('token-123');
    connection.getSellerId.mockResolvedValue('seller-9');
    client.fetchSettledPayments.mockResolvedValue([
      { externalReference: 'ORDER-1', amount: 199.9, settledAt: new Date('2026-09-05') },
    ]);

    const result = await provider.fetchSettledPayments({ marketplaceCode: 'MERCADO_LIVRE', tenantId: 'tenant-1', since });

    expect(client.fetchSettledPayments).toHaveBeenCalledWith('seller-9', 'token-123', since);
    expect(result).toEqual([{ externalReference: 'ORDER-1', amount: 199.9, settledAt: new Date('2026-09-05') }]);
  });
});
