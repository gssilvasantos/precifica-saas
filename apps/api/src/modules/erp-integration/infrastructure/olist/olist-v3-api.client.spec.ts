import { OlistV3ApiClient, OlistV3HttpError } from './olist-v3-api.client';
import { getRateLimitConfig } from '../../../../shared/rate-limiting/marketplace-rate-limits';

const SECRET = 'segredo-de-teste-nao-vazar';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('OlistV3ApiClient', () => {
  const originalEnv = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.OLIST_V3_ENABLED = 'true';
    process.env.OLIST_V3_CLIENT_ID = 'client-id-teste';
    process.env.OLIST_V3_CLIENT_SECRET = SECRET;
    process.env.OLIST_V3_REDIRECT_URI = 'https://api.exemplo.test/api/erp-integration/olist/v3/callback';
    delete process.env.OLIST_V3_API_BASE;
    delete process.env.OLIST_V3_AUTH_URL;
    delete process.env.OLIST_V3_TOKEN_URL;
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  it('tem entrada de cota OLIST_V3 de 1 req / 1333 ms', () => {
    expect(getRateLimitConfig('OLIST_V3')).toEqual({ requestsPerInterval: 1, intervalMs: 1333 });
  });

  describe('flags', () => {
    it('fica desligado por padrão e liga só com "true"', () => {
      const client = new OlistV3ApiClient();
      delete process.env.OLIST_V3_ENABLED;
      expect(client.isEnabled()).toBe(false);
      process.env.OLIST_V3_ENABLED = '1';
      expect(client.isEnabled()).toBe(false);
      process.env.OLIST_V3_ENABLED = 'true';
      expect(client.isEnabled()).toBe(true);
    });

    it('isConfigured exige id, segredo e redirect', () => {
      const client = new OlistV3ApiClient();
      expect(client.isConfigured()).toBe(true);
      delete process.env.OLIST_V3_CLIENT_SECRET;
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('monta a URL com client_id, redirect, state e sem o segredo', () => {
      const url = new URL(new OlistV3ApiClient().buildAuthorizeUrl('estado-123'));
      expect(url.origin + url.pathname).toBe('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth');
      expect(url.searchParams.get('client_id')).toBe('client-id-teste');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('estado-123');
      expect(url.searchParams.get('redirect_uri')).toBe(process.env.OLIST_V3_REDIRECT_URI);
      expect(url.toString()).not.toContain(SECRET);
    });

    it('falha alto sem variável obrigatória', () => {
      delete process.env.OLIST_V3_CLIENT_ID;
      expect(() => new OlistV3ApiClient().buildAuthorizeUrl('x')).toThrow(/OLIST_V3_CLIENT_ID/);
    });
  });

  describe('token', () => {
    it('troca o código enviando form-urlencoded', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ access_token: 'a', refresh_token: 'r', expires_in: 14400, refresh_expires_in: 86400 }),
      );
      const token = await new OlistV3ApiClient().exchangeCode('codigo-1');
      expect(token.access_token).toBe('a');
      const [, init] = fetchSpy.mock.calls[0];
      const body = new URLSearchParams(String(init.body));
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('codigo-1');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });

    it('renova com refresh_token', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ access_token: 'a2', refresh_token: 'r2', expires_in: 1 }));
      await new OlistV3ApiClient().refresh('r1');
      const body = new URLSearchParams(String(fetchSpy.mock.calls[0][1].body));
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('r1');
    });

    it('erro do provedor não vaza o segredo nem o corpo da requisição', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ error: 'invalid_grant', error_description: 'Code not valid' }, { status: 400 }));
      const error = await new OlistV3ApiClient().exchangeCode('ruim').catch((e: Error) => e);
      expect((error as Error).message).toContain('HTTP 400');
      expect((error as Error).message).toContain('Code not valid');
      expect((error as Error).message).not.toContain(SECRET);
      expect((error as Error).message).not.toContain('ruim');
    });

    it('rejeita resposta 200 sem tokens', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({}));
      await expect(new OlistV3ApiClient().refresh('r')).rejects.toThrow(/sem access_token/);
    });
  });

  describe('leitura', () => {
    it('listarProdutos monta a query com dataAlteracao e envia Bearer', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse({ itens: [] }, { headers: { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59', 'x-ratelimit-reset': '10' } }),
      );
      const res = await new OlistV3ApiClient().listarProdutos('tok', {
        limit: 5,
        situacao: 'A',
        dataAlteracao: '2026-10-05 10:00:00',
      });
      const [url, init] = fetchSpy.mock.calls[0];
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/public-api/v3/produtos');
      expect(parsed.searchParams.get('limit')).toBe('5');
      expect(parsed.searchParams.get('offset')).toBe('0');
      expect(parsed.searchParams.get('situacao')).toBe('A');
      expect(parsed.searchParams.get('dataAlteracao')).toBe('2026-10-05 10:00:00');
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(res.rateLimit).toEqual({ limit: 60, remaining: 59, resetSeconds: 10 });
    });

    it('sem cabeçalhos de cota devolve nulls', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ itens: [] }));
      const res = await new OlistV3ApiClient().listarProdutos('tok');
      expect(res.rateLimit).toEqual({ limit: null, remaining: null, resetSeconds: null });
    });

    it('obterProduto codifica o id no caminho', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ id: 1 }));
      await new OlistV3ApiClient().obterProduto('tok', '12/3');
      expect(new URL(String(fetchSpy.mock.calls[0][0])).pathname).toBe('/public-api/v3/produtos/12%2F3');
    });

    it('404 não é repetido e vira OlistV3HttpError', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ mensagem: 'nao existe' }, { status: 404 }));
      const error = await new OlistV3ApiClient().obterProduto('tok', 9).catch((e) => e);
      expect(error).toBeInstanceOf(OlistV3HttpError);
      expect(error.status).toBe(404);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('429 espera x-ratelimit-reset e tenta de novo', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { 'x-ratelimit-reset': '0' } }))
        .mockResolvedValueOnce(jsonResponse({ itens: [] }));
      const res = await new OlistV3ApiClient().listarProdutos('tok');
      expect(res.data).toEqual({ itens: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15_000);

    it('corpo que não é JSON vira erro claro', async () => {
      fetchSpy.mockResolvedValue(new Response('<html>', { status: 200 }));
      await expect(new OlistV3ApiClient().listarProdutos('tok')).rejects.toThrow(/não é JSON válido/);
    });

    it('usa OLIST_V3_API_BASE quando definida', async () => {
      process.env.OLIST_V3_API_BASE = 'https://sandbox.exemplo.test/v3/';
      fetchSpy.mockResolvedValue(jsonResponse({}));
      await new OlistV3ApiClient().listarProdutos('tok');
      expect(new URL(String(fetchSpy.mock.calls[0][0])).origin).toBe('https://sandbox.exemplo.test');
    });
  });
});
