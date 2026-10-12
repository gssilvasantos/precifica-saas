import { Injectable } from '@nestjs/common';
import { RateLimiter } from '../../../../shared/rate-limiting/rate-limiter';
import { getRateLimitConfig } from '../../../../shared/rate-limiting/marketplace-rate-limits';
import { isRateLimitError, withRetry } from '../../../../shared/rate-limiting/with-retry';

// Cliente da API v3 do Olist ERP (ADR 0003). Só infraestrutura: monta URL,
// fala HTTP, respeita cota e traduz erro. Não conhece tenant, token salvo nem
// regra de catálogo — quem renova e guarda token é OlistV3ConnectionService.
//
// SOMENTE LEITURA: este cliente não expõe nenhum método de escrita no Olist
// (mesma regra do OlistApiClient v2).
//
// Valores padrão de URL (base, autorização, token) são os que o rm-catalogo
// já usa em produção contra esta mesma conta Olist. Cada um pode ser trocado
// por variável de ambiente.
const DEFAULT_API_BASE = 'https://api.tiny.com.br/public-api/v3';
const DEFAULT_AUTH_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth';
const DEFAULT_TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';

const REQUEST_TIMEOUT_MS = 20_000;
// Teto de espera por resposta 429 / saldo baixo. O processo no Render free
// dorme após 15 min sem tráfego; uma espera longa dentro da requisição HTTP
// do usuário é pior que falhar com mensagem clara.
const MAX_RATE_WAIT_MS = 30_000;
const LOW_BALANCE_THRESHOLD = 5;

export interface OlistV3TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type?: string;
}

export interface OlistV3RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
}

export interface OlistV3Response<T> {
  data: T;
  rateLimit: OlistV3RateLimitInfo;
}

export interface OlistV3ListParams {
  limit?: number;
  offset?: number;
  situacao?: 'A' | 'I' | 'E';
  codigo?: string;
  // Formato aceito pelo Olist: "YYYY-MM-DD HH:mm:ss".
  dataAlteracao?: string;
}

export class OlistV3HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    // Corpo já truncado e sem segredo (ver truncateBody).
    readonly bodyExcerpt: string,
  ) {
    // "HTTP <status>" na mensagem: é a convenção que isRateLimitError() casa.
    super(`Olist v3 ${path} retornou HTTP ${status}${bodyExcerpt ? `: ${bodyExcerpt}` : ''}`);
    this.name = 'OlistV3HttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateBody(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 200);
}

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class OlistV3ApiClient {
  private readonly rateLimiter = new RateLimiter(getRateLimitConfig('OLIST_V3'));

  // Feature flag. Desligada por padrão: sem ela, nenhuma rota v3 funciona.
  isEnabled(): boolean {
    return process.env.OLIST_V3_ENABLED === 'true';
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.OLIST_V3_CLIENT_ID && process.env.OLIST_V3_CLIENT_SECRET && process.env.OLIST_V3_REDIRECT_URI,
    );
  }

  buildAuthorizeUrl(state: string): string {
    const url = new URL(process.env.OLIST_V3_AUTH_URL || DEFAULT_AUTH_URL);
    url.searchParams.set('client_id', this.requireEnv('OLIST_V3_CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.requireEnv('OLIST_V3_REDIRECT_URI'));
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeCode(code: string): Promise<OlistV3TokenResponse> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.requireEnv('OLIST_V3_REDIRECT_URI'),
    });
  }

  refresh(refreshToken: string): Promise<OlistV3TokenResponse> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  // GET /produtos — listagem paginada. `dataAlteracao` é o filtro do sync
  // incremental; `codigo` serve para localizar um SKU específico na verificação.
  listarProdutos(accessToken: string, params: OlistV3ListParams = {}): Promise<OlistV3Response<unknown>> {
    const query: Record<string, string> = {
      limit: String(params.limit ?? 100),
      offset: String(params.offset ?? 0),
    };
    if (params.situacao) query.situacao = params.situacao;
    if (params.codigo) query.codigo = params.codigo;
    if (params.dataAlteracao) query.dataAlteracao = params.dataAlteracao;
    return this.get(accessToken, '/produtos', query);
  }

  // GET /produtos/{id} — detalhe. Para uma variação, o id é o da própria
  // variação (o OpenAPI não tem consulta dedicada de variação).
  obterProduto(accessToken: string, id: string | number): Promise<OlistV3Response<unknown>> {
    return this.get(accessToken, `/produtos/${encodeURIComponent(String(id))}`);
  }

  private async get(
    accessToken: string,
    path: string,
    query: Record<string, string> = {},
  ): Promise<OlistV3Response<unknown>> {
    const url = new URL((process.env.OLIST_V3_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '') + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    return withRetry(() => this.rateLimiter.schedule(() => this.fetchOnce(url, path, accessToken)), {
      maxAttempts: 3,
      // Só 429 e erro de rede/timeout merecem nova tentativa; 401/403/404 não melhoram com espera.
      shouldRetry: (error) => isRateLimitError(error) || (error instanceof Error && /timeout|falha de rede/i.test(error.message)),
      // Espera de cota já acontece dentro de fetchOnce (x-ratelimit-reset); aqui só um respiro.
      backoffMs: [500, 500],
    });
  }

  private async fetchOnce(url: URL, path: string, accessToken: string): Promise<OlistV3Response<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Olist v3 ${path}: timeout após ${REQUEST_TIMEOUT_MS}ms`);
      }
      const cause = (error as { cause?: unknown }).cause;
      const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : '';
      throw new Error(`Olist v3 ${path}: falha de rede${causeMessage ? ` — causa: ${causeMessage}` : ''}`);
    } finally {
      clearTimeout(timer);
    }

    const rateLimit: OlistV3RateLimitInfo = {
      limit: numberHeader(response.headers, 'x-ratelimit-limit'),
      remaining: numberHeader(response.headers, 'x-ratelimit-remaining'),
      resetSeconds: numberHeader(response.headers, 'x-ratelimit-reset'),
    };

    if (response.status === 429) {
      const waitMs = Math.min((rateLimit.resetSeconds ?? 20) * 1000, MAX_RATE_WAIT_MS);
      await sleep(waitMs);
      throw new OlistV3HttpError(429, path, 'limite de requisições atingido');
    }

    const text = await response.text();
    if (!response.ok) throw new OlistV3HttpError(response.status, path, truncateBody(text));

    // Saldo baixo: espera a janela virar antes de liberar a próxima chamada,
    // em vez de gastar o resto da cota que outras integrações também usam.
    if (rateLimit.remaining !== null && rateLimit.remaining <= LOW_BALANCE_THRESHOLD) {
      await sleep(Math.min((rateLimit.resetSeconds ?? 5) * 1000, MAX_RATE_WAIT_MS));
    }

    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Olist v3 ${path} devolveu corpo que não é JSON válido.`);
    }
    return { data, rateLimit };
  }

  private async tokenRequest(params: Record<string, string>): Promise<OlistV3TokenResponse> {
    const body = new URLSearchParams({
      client_id: this.requireEnv('OLIST_V3_CLIENT_ID'),
      client_secret: this.requireEnv('OLIST_V3_CLIENT_SECRET'),
      ...params,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(process.env.OLIST_V3_TOKEN_URL || DEFAULT_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => ({}))) as Partial<OlistV3TokenResponse> & {
        error?: string;
        error_description?: string;
      };
      if (!response.ok || !json.access_token || !json.refresh_token) {
        // Só o código/descrição do erro do provedor: nunca o corpo da requisição (tem o segredo).
        throw new Error(
          `Olist v3 token (${params.grant_type}) retornou HTTP ${response.status}: ${truncateBody(
            String(json.error_description ?? json.error ?? 'resposta sem access_token'),
          )}`,
        );
      }
      return json as OlistV3TokenResponse;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Olist v3 token (${params.grant_type}): timeout após ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Variável de ambiente ${name} não configurada — a conexão com a API v3 do Olist não pode funcionar sem ela.`);
    return value;
  }
}
