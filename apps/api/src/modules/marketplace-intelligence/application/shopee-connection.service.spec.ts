import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ShopeeConnectionService } from './shopee-connection.service';
import { ShopeeConnectionRepository, ShopeeConnectionRecord } from './ports/shopee-connection-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { ShopeeApiClient, ShopeeOAuthTokenResponse } from '../infrastructure/providers/shopee/shopee-api-client';

function buildRecord(overrides: Partial<ShopeeConnectionRecord> = {}): ShopeeConnectionRecord {
  return {
    tenantId: 'tenant-1',
    shopId: '555',
    accessTokenEnc: 'enc(access-old)',
    refreshTokenEnc: 'enc(refresh-old)',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h no futuro — dentro da margem de segurança
    isActive: true,
    lastRefreshedAt: null,
    ...overrides,
  };
}

function buildTokenResponse(overrides: Partial<ShopeeOAuthTokenResponse> = {}): ShopeeOAuthTokenResponse {
  return {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    expire_in: 14400,
    shop_id: 555,
    partner_id: 1239393,
    ...overrides,
  };
}

describe('ShopeeConnectionService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      SHOPEE_PARTNER_ID: '1239393',
      SHOPEE_PARTNER_KEY: 'partner-key-secreta',
      SHOPEE_REDIRECT_URI: 'https://app.kyneti.dev/integrations/shopee/callback',
    };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  function buildService(record: ShopeeConnectionRecord | null = null) {
    const connections: jest.Mocked<ShopeeConnectionRepository> = {
      findByTenant: jest.fn().mockResolvedValue(record),
      findAllActive: jest.fn().mockResolvedValue(record ? [record] : []),
      upsert: jest.fn().mockImplementation((tenantId, data) =>
        Promise.resolve({ tenantId, isActive: true, lastRefreshedAt: new Date(), ...data }),
      ),
      deactivate: jest.fn().mockResolvedValue(undefined),
    };
    // CredentialEncryptionService real (não mockado) — mesmo racional do
    // teste do Mercado Livre: testa a ida-e-volta de verdade, inclusive
    // para o state do fluxo.
    const credentials = new CredentialEncryptionService();
    credentials.onModuleInit();
    const client: jest.Mocked<ShopeeApiClient> = {
      buildAuthPartnerUrl: jest.fn().mockReturnValue('https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=1239393&timestamp=1&sign=abc&redirect=x'),
      exchangeCodeForToken: jest.fn(),
      refreshAccessToken: jest.fn(),
    } as unknown as jest.Mocked<ShopeeApiClient>;

    const alerts = { emitAlert: jest.fn() };

    const service = new ShopeeConnectionService(connections, credentials, client, alerts);
    return { service, connections, credentials, client, alerts };
  }

  describe('buildAuthorizationUrl', () => {
    it('delega para ShopeeApiClient.buildAuthPartnerUrl com partner_id/key/redirect (state embutido)', () => {
      const { service, client } = buildService();

      const url = service.buildAuthorizationUrl('tenant-1');

      expect(url).toContain('auth_partner');
      expect(client.buildAuthPartnerUrl).toHaveBeenCalledWith(
        '1239393',
        'partner-key-secreta',
        expect.stringContaining('https://app.kyneti.dev/integrations/shopee/callback?state='),
      );
    });

    it('o state nunca expõe o tenantId em texto puro no redirect passado ao client', () => {
      const { service, client } = buildService();

      service.buildAuthorizationUrl('tenant-super-secreto');

      const [, , redirectUri] = client.buildAuthPartnerUrl.mock.calls[0];
      expect(redirectUri).not.toContain('tenant-super-secreto');
    });
  });

  describe('handleCallback', () => {
    it('decodifica o state, troca o code por tokens (com shopId) e persiste criptografado', async () => {
      const { service, connections, client } = buildService();
      client.exchangeCodeForToken.mockResolvedValue(buildTokenResponse());
      service.buildAuthorizationUrl('tenant-1');
      const redirectUri = client.buildAuthPartnerUrl.mock.calls[0][2] as string;
      const state = decodeURIComponent(redirectUri.split('state=')[1]);

      await service.handleCallback('auth-code-xyz', '555', state);

      expect(client.exchangeCodeForToken).toHaveBeenCalledWith('1239393', 'partner-key-secreta', 'auth-code-xyz', '555');
      expect(connections.upsert).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ shopId: '555' }));
      // Nunca persiste o token em texto puro.
      const [, upsertData] = connections.upsert.mock.calls[0];
      expect(upsertData.accessTokenEnc).not.toContain('new-access-token');
      expect(upsertData.refreshTokenEnc).not.toContain('new-refresh-token');
    });

    it('state adulterado (payload inválido): lança BadRequestException, nunca chama o client', async () => {
      const { service, client } = buildService();

      await expect(service.handleCallback('code', '555', 'lixo-nao-criptografado')).rejects.toThrow(BadRequestException);
      expect(client.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('state expirado (issuedAt antigo): lança BadRequestException', async () => {
      const { service, credentials, client } = buildService();
      const staleState = credentials.encrypt(JSON.stringify({ tenantId: 'tenant-1', issuedAt: Date.now() - 20 * 60 * 1000 }));

      await expect(service.handleCallback('code', '555', staleState)).rejects.toThrow(BadRequestException);
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

    it('token ainda válido: devolve o token decifrado, NUNCA renova', async () => {
      const { service, connections, client, credentials } = buildService(null);
      const record = buildRecord({ accessTokenEnc: credentials.encrypt('access-valido') });
      connections.findByTenant.mockResolvedValue(record);

      const token = await service.getValidAccessToken('tenant-1');

      expect(token).toBe('access-valido');
      expect(client.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('token vencido: renova automaticamente via refreshAccessToken (com shopId) e persiste o novo par', async () => {
      const { service, connections, client, credentials } = buildService(null);
      const record = buildRecord({
        refreshTokenEnc: credentials.encrypt('refresh-valido'),
        expiresAt: new Date(Date.now() - 1000), // já vencido
      });
      connections.findByTenant.mockResolvedValue(record);
      client.refreshAccessToken.mockResolvedValue(buildTokenResponse({ access_token: 'renovado-123' }));

      const token = await service.getValidAccessToken('tenant-1');

      expect(client.refreshAccessToken).toHaveBeenCalledWith('1239393', 'partner-key-secreta', 'refresh-valido', '555');
      expect(token).toBe('renovado-123');
      expect(connections.upsert).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ shopId: '555' }));
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
      client.refreshAccessToken.mockRejectedValue(new Error('refresh_token revogado pela Shopee'));

      await expect(service.getValidAccessToken('tenant-1')).rejects.toThrow('refresh_token revogado pela Shopee');

      expect(alerts.emitAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'ShopeeConnectionService',
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

    it('getStatus com conexão ativa: expõe shopId/expiresAt, nunca os tokens', async () => {
      const { service } = buildService(buildRecord());
      const status = await service.getStatus('tenant-1');
      expect(status).toMatchObject({ connected: true, isActive: true, shopId: '555' });
      expect(JSON.stringify(status)).not.toContain('accessTokenEnc');
    });

    it('listActiveTenantIds devolve os tenants com conexão ativa', async () => {
      const { service } = buildService(buildRecord());
      await expect(service.listActiveTenantIds()).resolves.toEqual(['tenant-1']);
    });
  });
});
