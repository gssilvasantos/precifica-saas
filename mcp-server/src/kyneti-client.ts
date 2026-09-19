import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Cliente HTTP para a API do Kyneti, autenticado como usuário de serviço
 * (role VIEWER — ver README.md).
 *
 * A API do Kyneti não tem mecanismo de API key (confirmado por inspeção do
 * código em 18/09/2026 — apps/api/src/modules/identity-access): o único
 * jeito de autenticar é POST /auth/login, que devolve um JWT válido por
 * JWT_EXPIRES_IN (padrão 8h no backend) e não tem refresh token. Por isso
 * este cliente guarda e-mail/senha em memória (nunca em log, nunca no
 * corpo de uma resposta MCP) e refaz login automaticamente antes do token
 * expirar, decodificando o `exp` do próprio JWT em vez de assumir 8h fixo
 * — mais robusto a mudanças de JWT_EXPIRES_IN no backend sem precisar
 * tocar aqui.
 */

export interface KyneteClientConfig {
  baseUrl: string;
  email: string;
  password: string;
  tenantId?: string;
}

interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    tenantId: string;
    tenantName: string;
    role: string;
    isPlatformAdmin: boolean;
    moduleAccess: string[];
  };
}

function decodeJwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Reautentica com essa margem de segurança antes do exp real do JWT, para
// nunca disparar uma chamada de ferramenta com um token prestes a expirar
// no meio da requisição.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class KyneteApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'KyneteApiError';
  }
}

export class KyneteClient {
  private readonly http: AxiosInstance;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private loginPromise: Promise<void> | null = null;

  constructor(private readonly config: KyneteClientConfig) {
    this.http = axios.create({ baseURL: config.baseUrl, timeout: 20_000 });
  }

  private async ensureToken(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt - REFRESH_MARGIN_MS) return;
    // Evita duas chamadas concorrentes de /auth/login se duas ferramentas
    // forem chamadas ao mesmo tempo com o token expirado.
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async login(): Promise<void> {
    try {
      const { data } = await this.http.post<LoginResponse>('/auth/login', {
        email: this.config.email,
        password: this.config.password,
        ...(this.config.tenantId ? { tenantId: this.config.tenantId } : {}),
      });
      this.token = data.accessToken;
      this.tokenExpiresAt = decodeJwtExpiry(data.accessToken) ?? Date.now() + 8 * 60 * 60 * 1000;
    } catch (error) {
      // Nunca inclui a senha na mensagem de erro — só o status/mensagem que
      // a própria API do Kyneti devolveu.
      throw new KyneteApiError(
        `Falha ao autenticar a conta de serviço do MCP no Kyneti: ${extractErrorMessage(error)}`,
        (error as AxiosError).response?.status,
      );
    }
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    await this.ensureToken();
    try {
      const { data } = await this.http.get<T>(path, {
        params,
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return data;
    } catch (error) {
      const status = (error as AxiosError).response?.status;
      if (status === 401) {
        // Token pode ter sido revogado/expirado antes do previsto — refaz
        // login uma única vez e tenta de novo, para não propagar um 401
        // "falso" por causa de clock skew ou de moduleAccess alterado.
        this.token = null;
        await this.ensureToken();
        const { data } = await this.http.get<T>(path, {
          params,
          headers: { Authorization: `Bearer ${this.token}` },
        });
        return data;
      }
      throw new KyneteApiError(`Kyneti API respondeu ${status ?? 'erro de rede'} em ${path}: ${extractErrorMessage(error)}`, status);
    }
  }
}

function extractErrorMessage(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string | string[] }>;
  const body = axiosError.response?.data;
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = body.message;
    return Array.isArray(msg) ? msg.join('; ') : String(msg ?? axiosError.message);
  }
  return axiosError.message ?? 'erro desconhecido';
}
