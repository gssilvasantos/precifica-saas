import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MercadoLivreConnectionService } from './mercado-livre-connection.service';
import { MercadoLivreConnectionRepository, MercadoLivreConnectionRecord } from './ports/mercado-livre-connection-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { MercadoLivreApiClient, MlOAuthTokenResponse } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';

function buildRecord(overrides: Partial<MercadoLivreConnectionRecord> = {}): MercadoLivreConnectionRecord {
  return {
    tenantId: 'tenant-1',
    sellerId: '999',
    accessTokenEnc: 'enc(access-old)',
    refreshTokenEnc: 'enc(refresh-old)',
    tokenType: 'bearer',
    scope: 'offline_access read',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h no futuro — bem dentro da margem de segurança
    isActive: true,
    lastRefreshedAt: null,
    ...overrides,
  };
}

function buildTokenResponse(overrides: Partial<MlOAuthTokenResponse> = {}): MlOAuthTokenResponse {
  return {
    access_token: 'new-access-token',
    token_type: 'bearer',
    expires_in: 21600,
    scope: 'offline_access read',
    user_id: 999,
    refresh_token: 'new-refresh-token',
    ...overrides,
  };
}

describe('MercadoLivreConnectionService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      MERCADO_LIVRE_CLIENT_ID: 'client-id-123',
      MERCADO_LIVRE_CLIENT_SECRET: 'client-secret-456',
      MERCADO_LIVRE_REDIRECT_URI: 'https://app.kyneti.dev/integrations/mercado-livre/callback',
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function buildService(record: MercadoLivreConnectionRecord | null = null) {
    const connections: jest.Mocked<MercadoLivreConnectionRepository> = {
      findByTenant: jest.fn().mockResolvedValue(record),
      findAllActive: jest.fn().mockResolvedValue(record ? [record] : []),
      upsert: jest.fn().mockImplementation((tenantId, data) =>
        Promise.resolve({ tenantId, isActive: true, lastRefreshedAt: new Date(), ...data }),
      ),
      deactivate: jest.fn().mockResolvedValue(undefined),
    };
    // CredentialEncryptionService real (não mockado) — testa a ida-e-volta
    // de verdade (encrypt/decrypt), inclusive para o state do OAuth2.
    const credentials = new CredentialEncryptionService();
    credentials.onModuleInit();
    const client: jest.Mocked<MercadoLivreApiClient> = {
      exchangeCodeForToken: jest.fn(),
      refreshAccessToken: jest.fn(),
      fetchOrders: jest.fn(),
      fetchTopLevelCategories: jest.fn(),
      fetchListingPrices: jest.fn(),
    } as unknown as jest.Mocked<MercadoLivreApiClient>;

    const alerts = { emitAlert: jest.fn() };

    const service = new MercadoLivreConnectionService(connections, credentials, client, alerts);
    return { service, connections, credentials, client, alerts };
  }

  describe('buildAuthorizationUrl', () => {
    it('monta a URL de autorização com client_id/redirect_uri/state', () => {
      const { service } = buildService();

      const url = service.buildAuthorizationUrl('tenant-1');

      expect(url).toContain('https://auth.mercadolivre.com.br/authorization?');
      expect(url).toContain('client_id=client-id-123');
      expect(url).toContain('response_type=code');
      expect(url).toMatch(/state=/);
    });

    it('o state nunca expõe o tenantId em texto puro na URL', () => {
      const { service } = buildService();

      const url = service.buildAuthorizationUrl('tenant-super-secreto');

      expect(url).not.toContain('tenant-super-secreto');
    });
  });

  describe('handleCallback', () => {
    it('decodifica o state, troca o code por tokens e persiste criptografado', async () => {
      const { service, connections, client } = buildService();
      client.exchangeCodeForToken.mockResolvedValue(buildTokenResponse());
      const state = service.buildAuthorizationUrl('tenant-1').match(/state=([^&]+)/)![1];
      const decodedState = decodeURIComponent(state);

      await service.handleCallback('auth-code-xyz', decodedState);

      expect(client.exchangeCodeForToken).toHaveBeenCalledWith(
        'client-id-123',
        'client-secret-456',
        'auth-code-xyz',
        'https://app.kyneti.dev/integrations/mercado-livre/callback',
      );
      expect(connections.upsert).toHaveBeenCalledWith(
        'tenant-1',
        expect.objectContaining({ sellerId: '999' }),
      );
      // Nunca persiste o token em texto puro.
      const [, upsertData] = connections.upsert.mock.calls[0];
      expect(upsertData.accessTokenEnc).not.toContain('new-access-token');
      expect(upsertData.refreshTokenEnc).not.toContain('new-refresh-token');
    });

    it('state adulterado (payload inválido): lança BadRequestException, nunca chama o client', async () => {
      const { service, client } = buildService();

      await expect(service.handleCallback('code', 'lixo-nao-criptografado')).rejects.toThrow(BadRequestException);
      expect(client.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('state expirado (issuedAt antigo): lança BadRequestException', async () => {
      const { service, credentials, client } = buildService();
      const staleState = credentials.encrypt(JSON.stringify({ tenantId: 'tenant-1', issuedAt: Date.now() - 20 * 60 * 1000 }));

      await expect(service.handleCallback('code', staleState)).rejects.toThrow(BadRequestException);
      expect(client.exchangeCodeForToken).not.toHaveBeenCalled();
    });
  });

  describe('getValidAccessToken', () => {
    it('sem tenantId: lança BadRequestException (authScope TENANT exige tenant)', async () => {
      const { service } = buildService();
      await expect(service.getValidAccessToken(undefined)).rejects.toThrow(BadRequestException);
    });

    it('sem conexão ativa: lança NotFoundException', async () => {
      const { service } = buildService(null);
      await expect(service.getValidAccessToken('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('token ainda válido (bem dentro da margem de segurança): devolve o token decifrado, NUNCA renova', async () => {
      // buildService cria sua própria CredentialEncryptionService (chave dev
      // determinística, mesmo processo) — usamos o helper devolvido para
      // gerar o ciphertext do fixture, garantindo que a mesma chave decifra.
      const { service, connections, client, credentials } = buildService(null);
      const record = buildRecord({ accessTokenEnc: credentials.encrypt('access-valido') });
      connections.findByTenant.mockResolvedValue(record);

      const token = await service.getValidAccessToken('tenant-1');

      expect(token).toBe('access-valido');
      expect(client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('token vencido: renova automaticamente via refreshAccessToken e persiste o novo par', async () => {
      const { service, connections, client, credentials } = buildService(null);
      const record = buildRecord({
        refreshTokenEnc: credentials.encrypt('refresh-valido'),
        expiresAt: new Date(Date.now() - 1000), // já vencido
      });
      connections.findByTenant.mockResolvedValue(record);
      client.refreshAccessToken.mockResolvedValue(buildTokenResponse({ access_token: 'renovado-123' }));

      const token = await service.getValidAccessToken('tenant-1');

      expect(client.refreshAccessToken).toHaveBeenCalledWith('client-id-123', 'client-secret-456', 'refresh-valido');
      expect(token).toBe('renovado-123');
      expect(connections.upsert).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ sellerId: '999' }));
    });

    it('token perto de expirar (dentro da margem de segurança): renova ANTES de vencer de verdade', async () => {
      const { service, connections, client, credentials } = buildService(null);
      const record = buildRecord({
        refreshTokenEnc: credentials.encrypt('refresh-valido'),
        expiresAt: new Date(Date.now() + 60 * 1000), // 1 min no futuro — dentro da margem de 5 min
      });
      connections.findByTenant.mockResolvedValue(record);
      client.refreshAccessToken.mockResolvedValue(buildTokenResponse());

      await service.getValidAccessToken('tenant-1');

      expect(client.refreshAccessToken).toHaveBeenCalled();
    });

    it('Observabilidade: falha no refreshAccessToken emite alerta técnico ERROR e relança o erro original', async () => {
      const { service, connections, client, credentials, alerts } = buildService(null);
      const record = buildRecord({
        refreshTokenEnc: credentials.encrypt('refresh-valido'),
        expiresAt: new Date(Date.now() - 1000), // já vencido
      });
      connections.findByTenant.mockResolvedValue(record);
      client.refreshAccessToken.mockRejectedValue(new Error('refresh_token revogado pelo Mercado Livre'));

      await expect(service.getValidAccessToken('tenant-1')).rejects.toThrow('refresh_token revogado pelo Mercado Livre');

      expect(alerts.emitAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'MercadoLivreConnectionService',
          severity: 'ERROR',
          context: expect.objectContaining({ tenantId: 'tenant-1' }),
        }),
      );
    });
  });

  describe('disconnect / getStatus / listActiveTenantIds', () => {
    it('disconnect sem conexão existente: lança NotFoundException', async () => {
      const { service } = buildService(null);
      await expect(service.disconnect('tenant-1')).rejects.toThrow(NotFoundException);
    });

    it('disconnect desativa a conexão existente', async () => {
      const { service, connections } = buildService(buildRecord());
      await service.disconnect('tenant-1');
      expect(connections.deactivate).toHaveBeenCalledWith('tenant-1');
    });

    it('getStatus sem conexão: connected false', async () => {
      const { service } = buildService(null);
      await expect(service.getStatus('tenant-1')).resolves.toMatchObject({ connected: false, isActive: false });
    });

    it('getStatus com conexão ativa: expõe sellerId/expiresAt, nunca os tokens', async () => {
      const { service } = buildService(buildRecord());
      const status = await service.getStatus('tenant-1');
      expect(status).toMatchObject({ connected: true, isActive: true, sellerId: '999' });
      expect(JSON.stringify(status)).not.toContain('accessTokenEnc');
    });

    it('listActiveTenantIds devolve os tenants com conexão ativa', async () => {
      const { service } = buildService(buildRecord());
      await expect(service.listActiveTenantIds()).resolves.toEqual(['tenant-1']);
    });
  });
});
