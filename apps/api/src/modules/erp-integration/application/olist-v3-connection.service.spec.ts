import { BadRequestException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OlistV3ConnectionService } from './olist-v3-connection.service';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Cobre o ciclo de vida da credencial OAuth2 da v3 (ADR 0003): flag, state,
// callback, renovação e isolamento entre contas. Repositório e cliente são
// fakes de porta; a criptografia é a real (o state precisa de ida e volta).

interface Stored {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
  connectedAt: Date | null;
}

const MIN = 60_000;

function montar(opcoes: { enabled?: boolean; configured?: boolean; contasV2?: string[] } = {}) {
  process.env.ERP_CREDENTIALS_ENCRYPTION_KEY = 'chave-de-teste-nao-usar-em-producao';
  const credentials = new CredentialEncryptionService();
  credentials.onModuleInit();

  const contasV2 = new Set(opcoes.contasV2 ?? ['tenant-a', 'tenant-b']);
  const tokens = new Map<string, Stored>();
  const connections = {
    findV3Tokens: jest.fn(async (tenantId: string) => tokens.get(tenantId) ?? null),
    saveV3Tokens: jest.fn(async (tenantId: string, t: Omit<Stored, 'connectedAt'>, markConnected: boolean) => {
      if (!contasV2.has(tenantId)) return false;
      const anterior = tokens.get(tenantId);
      tokens.set(tenantId, { ...t, connectedAt: markConnected ? new Date() : (anterior?.connectedAt ?? null) });
      return true;
    }),
    clearV3Tokens: jest.fn(async (tenantId: string) => void tokens.delete(tenantId)),
  };
  const client = {
    isEnabled: jest.fn().mockReturnValue(opcoes.enabled ?? true),
    isConfigured: jest.fn().mockReturnValue(opcoes.configured ?? true),
    buildAuthorizeUrl: jest.fn((state: string) => `https://auth.exemplo.invalid/auth?state=${encodeURIComponent(state)}`),
    exchangeCode: jest.fn().mockResolvedValue({ access_token: 'acesso-1', refresh_token: 'refresh-1', expires_in: 14400, refresh_expires_in: 86400 }),
    refresh: jest.fn().mockResolvedValue({ access_token: 'acesso-2', refresh_token: 'refresh-2', expires_in: 14400, refresh_expires_in: 86400 }),
  };
  const alerts = { emitAlert: jest.fn() };
  const service = new OlistV3ConnectionService(connections as never, credentials, client as never, alerts as never);

  const gravar = (tenantId: string, parcial: Partial<Stored> = {}) =>
    tokens.set(tenantId, {
      accessTokenEnc: credentials.encrypt('acesso-gravado'),
      refreshTokenEnc: credentials.encrypt('refresh-gravado'),
      accessExpiresAt: new Date(Date.now() + 60 * MIN),
      refreshExpiresAt: new Date(Date.now() + 600 * MIN),
      connectedAt: new Date(),
      ...parcial,
    });

  const stateDe = (url: string) => new URL(url).searchParams.get('state') as string;
  return { service, client, connections, alerts, credentials, tokens, gravar, stateDe };
}

describe('OlistV3ConnectionService — flag', () => {
  it('flag desligada: toda operação recusa com código estável e nada chama o Olist', async () => {
    const { service, client } = montar({ enabled: false });
    await expect(service.getValidAccessToken('tenant-a')).rejects.toMatchObject({ response: { code: 'OLIST_V3_DISABLED' } });
    expect(() => service.buildAuthorizationUrl('tenant-a')).toThrow(ServiceUnavailableException);
    await expect(service.handleCallback('c', 's')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.exchangeCode).not.toHaveBeenCalled();
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('ligada mas sem variáveis do app: código OLIST_V3_NOT_CONFIGURED', () => {
    const { service } = montar({ configured: false });
    expect(() => service.buildAuthorizationUrl('tenant-a')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'OLIST_V3_NOT_CONFIGURED' }) }),
    );
  });

  it('status com a flag desligada não consulta o banco e informa enabled=false', async () => {
    const { service, connections } = montar({ enabled: false });
    const status = await service.getStatus('tenant-a');
    expect(status).toMatchObject({ enabled: false, connected: false });
    expect(connections.findV3Tokens).not.toHaveBeenCalled();
  });
});

describe('OlistV3ConnectionService — OAuth', () => {
  it('callback com state válido troca o code e grava os dois tokens criptografados, só na conta do state', async () => {
    const { service, client, tokens, credentials, stateDe } = montar();
    const state = stateDe(service.buildAuthorizationUrl('tenant-a'));

    await service.handleCallback('codigo-1', state);

    expect(client.exchangeCode).toHaveBeenCalledWith('codigo-1');
    const guardado = tokens.get('tenant-a') as Stored;
    expect(guardado.accessTokenEnc).not.toContain('acesso-1');
    expect(credentials.decrypt(guardado.accessTokenEnc)).toBe('acesso-1');
    expect(credentials.decrypt(guardado.refreshTokenEnc)).toBe('refresh-1');
    expect(guardado.connectedAt).not.toBeNull();
    expect(tokens.has('tenant-b')).toBe(false);
  });

  it('o state não expõe o tenantId em texto puro', () => {
    const { service, stateDe } = montar();
    expect(stateDe(service.buildAuthorizationUrl('tenant-a'))).not.toContain('tenant-a');
  });

  it('a gravação do callback roda no contexto do tenant do state, não em bypass', async () => {
    const { service, connections, stateDe } = montar();
    let tenantVisto: string | null | undefined;
    connections.saveV3Tokens.mockImplementationOnce(async () => {
      tenantVisto = TenantContextStore.getTenantId();
      return true;
    });
    await service.handleCallback('c', stateDe(service.buildAuthorizationUrl('tenant-b')));
    expect(tenantVisto).toBe('tenant-b');
  });

  it('state adulterado, lixo ou vazio é recusado antes de trocar o code', async () => {
    const { service, client, stateDe } = montar();
    const valido = stateDe(service.buildAuthorizationUrl('tenant-a'));
    const adulterado = valido.slice(0, -4) + 'AAAA';
    for (const ruim of [adulterado, 'lixo', 'a.b.c', '']) {
      await expect(service.handleCallback('c', ruim)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('state expirado (> 10 min) é recusado', async () => {
    const { service, client, stateDe } = montar();
    const state = stateDe(service.buildAuthorizationUrl('tenant-a'));
    const agora = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(agora + 11 * MIN);
    try {
      await expect(service.handleCallback('c', state)).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      spy.mockRestore();
    }
    expect(client.exchangeCode).not.toHaveBeenCalled();
  });

  it('conta sem conexão v2 não ganha linha nova: erro claro e nada gravado', async () => {
    const { service, tokens, stateDe } = montar({ contasV2: [] });
    const state = stateDe(service.buildAuthorizationUrl('tenant-a'));
    await expect(service.handleCallback('c', state)).rejects.toMatchObject({
      response: { code: 'OLIST_V2_CONNECTION_REQUIRED' },
    });
    expect(tokens.size).toBe(0);
  });

  it('falha na troca do code propaga e não grava nada', async () => {
    const { service, client, tokens, stateDe } = montar();
    client.exchangeCode.mockRejectedValueOnce(new Error('Olist v3 token (authorization_code) retornou HTTP 400: invalid_grant'));
    await expect(service.handleCallback('c', stateDe(service.buildAuthorizationUrl('tenant-a')))).rejects.toThrow('invalid_grant');
    expect(tokens.size).toBe(0);
  });
});

describe('OlistV3ConnectionService — token de acesso', () => {
  it('token válido: devolve decifrado, sem renovar', async () => {
    const { service, client, gravar } = montar();
    gravar('tenant-a');
    await expect(service.getValidAccessToken('tenant-a')).resolves.toBe('acesso-gravado');
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('a menos de 5 min de vencer: renova, grava o novo par e devolve o novo token', async () => {
    const { service, client, gravar, tokens, credentials } = montar();
    gravar('tenant-a', { accessExpiresAt: new Date(Date.now() + 2 * MIN) });

    await expect(service.getValidAccessToken('tenant-a')).resolves.toBe('acesso-2');

    expect(client.refresh).toHaveBeenCalledWith('refresh-gravado');
    const guardado = tokens.get('tenant-a') as Stored;
    expect(credentials.decrypt(guardado.accessTokenEnc)).toBe('acesso-2');
    expect(credentials.decrypt(guardado.refreshTokenEnc)).toBe('refresh-2');
  });

  it('renovações simultâneas da mesma conta viram UMA chamada ao Olist (refresh token pode ser rotacionado)', async () => {
    const { service, client, gravar } = montar();
    gravar('tenant-a', { accessExpiresAt: new Date(Date.now() - MIN) });
    let liberar!: () => void;
    client.refresh.mockImplementationOnce(
      () => new Promise((resolve) => (liberar = () => resolve({ access_token: 'acesso-2', refresh_token: 'refresh-2', expires_in: 14400 }))),
    );

    const chamadas = [service.getValidAccessToken('tenant-a'), service.getValidAccessToken('tenant-a'), service.getValidAccessToken('tenant-a')];
    await Promise.resolve();
    await Promise.resolve();
    liberar();

    await expect(Promise.all(chamadas)).resolves.toEqual(['acesso-2', 'acesso-2', 'acesso-2']);
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });

  it('falha na renovação emite alerta ERROR sem token no contexto e propaga; a próxima chamada pode tentar de novo', async () => {
    const { service, client, alerts, gravar } = montar();
    gravar('tenant-a', { accessExpiresAt: new Date(Date.now() - MIN) });
    client.refresh.mockRejectedValueOnce(new Error('Olist v3 token (refresh_token) retornou HTTP 400: invalid_grant'));

    await expect(service.getValidAccessToken('tenant-a')).rejects.toThrow('invalid_grant');

    expect(alerts.emitAlert).toHaveBeenCalledTimes(1);
    const alerta = alerts.emitAlert.mock.calls[0][0];
    expect(alerta.severity).toBe('ERROR');
    expect(JSON.stringify(alerta)).not.toContain('refresh-gravado');
    expect(JSON.stringify(alerta)).not.toContain('acesso-gravado');

    await expect(service.getValidAccessToken('tenant-a')).resolves.toBe('acesso-2');
  });

  it('refresh token vencido: pede reconexão sem chamar o Olist', async () => {
    const { service, client, gravar } = montar();
    gravar('tenant-a', {
      accessExpiresAt: new Date(Date.now() - MIN),
      refreshExpiresAt: new Date(Date.now() - MIN),
    });
    await expect(service.getValidAccessToken('tenant-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('conta nunca conectada na v3: 404 com código estável', async () => {
    const { service } = montar();
    await expect(service.getValidAccessToken('tenant-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getValidAccessToken('tenant-a')).rejects.toMatchObject({ response: { code: 'OLIST_V3_NOT_CONNECTED' } });
  });

  it('ISOLAMENTO: a conta B nunca recebe o token da conta A', async () => {
    const { service, gravar, credentials, tokens } = montar();
    gravar('tenant-a', { accessTokenEnc: credentials.encrypt('so-da-conta-a') });
    await expect(service.getValidAccessToken('tenant-b')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getValidAccessToken('tenant-a')).resolves.toBe('so-da-conta-a');
    expect(tokens.has('tenant-b')).toBe(false);
  });

  it('renovação de uma conta não bloqueia nem reaproveita a de outra', async () => {
    const { service, client, gravar } = montar();
    gravar('tenant-a', { accessExpiresAt: new Date(Date.now() - MIN) });
    gravar('tenant-b', { accessExpiresAt: new Date(Date.now() - MIN) });
    await Promise.all([service.getValidAccessToken('tenant-a'), service.getValidAccessToken('tenant-b')]);
    expect(client.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('OlistV3ConnectionService — status e desconexão', () => {
  it('status conectado traz datas e nunca o token', async () => {
    const { service, gravar } = montar();
    gravar('tenant-a');
    const status = await service.getStatus('tenant-a');
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain('acesso-gravado');
    expect(Object.keys(status).sort()).toEqual(
      ['accessExpiresAt', 'configured', 'connected', 'connectedAt', 'enabled', 'refreshExpiresAt'].sort(),
    );
  });

  it('desconectar apaga só a conta pedida; desconectar quem não conectou dá 404', async () => {
    const { service, gravar, tokens } = montar();
    gravar('tenant-a');
    gravar('tenant-b');
    await service.disconnect('tenant-a');
    expect(tokens.has('tenant-a')).toBe(false);
    expect(tokens.has('tenant-b')).toBe(true);
    await expect(service.disconnect('tenant-a')).rejects.toBeInstanceOf(NotFoundException);
  });
});
