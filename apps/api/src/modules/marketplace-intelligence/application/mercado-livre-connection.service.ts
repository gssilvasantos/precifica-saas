import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { AuthStrategy } from '../../../shared/contracts/auth-strategy.contract';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { MercadoLivreApiClient, MlOAuthTokenResponse } from '../infrastructure/providers/mercado-livre/mercado-livre-api.client';
import {
  MERCADO_LIVRE_CONNECTION_REPOSITORY,
  MercadoLivreConnectionRepository,
} from './ports/mercado-livre-connection-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';

const AUTHORIZE_URL = 'https://auth.mercadolivre.com.br/authorization';

// Janela de tolerância para o `state` do OAuth2 — protege contra um link de
// autorização antigo (aberto, esquecido numa aba, ou reenviado por engano)
// sendo usado depois que o fluxo deveria ter sido concluído. 10 minutos é
// folgado o bastante para o vendedor completar o login/aprovação real no
// Mercado Livre sem fricção.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Margem de segurança do refresh automático: renova o token 5 minutos ANTES
// de expirar, nunca exatamente no limite — evita uma corrida entre "o token
// ainda parece válido" e "a chamada real à API chega alguns segundos depois
// e é rejeitada por token vencido" (latência de rede, clock skew).
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface MercadoLivreConnectionStatus {
  connected: boolean;
  isActive: boolean;
  sellerId: string | null;
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
}

// Sprint 22 — gerencia o ciclo de vida completo da credencial OAuth2 do
// Mercado Livre por tenant: autorização, troca de code, renovação
// automática e desconexão. Implementa AuthStrategy (shared/contracts/,
// definida desde a Etapa 4 e nunca implementada até agora) — é o primeiro
// provider da plataforma que de fato precisa desse contrato, exatamente
// como o comentário original previa.
//
// Ver docs/auth-security.md para o racional completo de segurança
// (criptografia em repouso, proteção do `state`, janela de renovação).
@Injectable()
export class MercadoLivreConnectionService implements AuthStrategy {
  readonly type = 'OAUTH2' as const;
  readonly scope = 'TENANT' as const;

  private readonly logger = new Logger(MercadoLivreConnectionService.name);

  constructor(
    @Inject(MERCADO_LIVRE_CONNECTION_REPOSITORY) private readonly connections: MercadoLivreConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: MercadoLivreApiClient,
    // Observabilidade básica (Fase de Conexão Real) — uma falha na renovação
    // automática de token é o pior tipo de falha silenciosa possível aqui:
    // se ninguém for avisado, a conexão do tenant simplesmente para de
    // funcionar na próxima chamada, sem log nenhum apontando a causa raiz.
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  // Passo 1 do fluxo — nenhuma chamada de rede, só monta a URL para a qual
  // o FRONTEND deve redirecionar o usuário. `state` carrega o tenantId de
  // forma criptografada (nunca em texto puro na URL) para que o callback
  // público (sem JWT, o Mercado Livre é quem chama) saiba a qual conta
  // aplicar o resultado, sem exigir sessão/cookie carregado através do
  // redirecionamento externo.
  buildAuthorizationUrl(tenantId: string): string {
    const state = this.encodeState(tenantId);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.requireEnv('MERCADO_LIVRE_CLIENT_ID'),
      redirect_uri: this.requireEnv('MERCADO_LIVRE_REDIRECT_URI'),
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  // Passo 2 — chamado pelo controller de callback (público, sem guard) com
  // o `code`/`state` que o Mercado Livre devolve no redirect do navegador
  // do vendedor. Decodifica o state (valida integridade + freshness),
  // troca o code por tokens e persiste criptografado.
  async handleCallback(code: string, state: string): Promise<void> {
    const tenantId = this.decodeState(state);
    const token = await this.client.exchangeCodeForToken(
      this.requireEnv('MERCADO_LIVRE_CLIENT_ID'),
      this.requireEnv('MERCADO_LIVRE_CLIENT_SECRET'),
      code,
      this.requireEnv('MERCADO_LIVRE_REDIRECT_URI'),
    );
    await this.persistToken(tenantId, token);
    this.logger.log(`Conexão Mercado Livre estabelecida para tenant ${tenantId} (seller ${token.user_id}).`);
  }

  // O CORAÇÃO do item 2 do pedido: verifica expiração e renova
  // AUTOMATICAMENTE antes de devolver o token — quem chama isto (o
  // provider, via ensureValidCredentials) nunca precisa saber se o token
  // estava perto de vencer ou não. Implementa a assinatura de AuthStrategy.
  async getValidAccessToken(tenantId?: string): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('MercadoLivreConnectionService.getValidAccessToken exige tenantId (authScope TENANT).');
    }
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing || !existing.isActive) {
      throw new NotFoundException(`Tenant ${tenantId} não tem conexão ativa com o Mercado Livre.`);
    }

    const msUntilExpiry = existing.expiresAt.getTime() - Date.now();
    if (msUntilExpiry > REFRESH_SAFETY_MARGIN_MS) {
      return this.credentials.decrypt(existing.accessTokenEnc);
    }

    this.logger.log(
      `Access token do tenant ${tenantId} (Mercado Livre) ${msUntilExpiry <= 0 ? 'expirado' : 'perto de expirar'} — renovando automaticamente.`,
    );
    try {
      const refreshed = await this.client.refreshAccessToken(
        this.requireEnv('MERCADO_LIVRE_CLIENT_ID'),
        this.requireEnv('MERCADO_LIVRE_CLIENT_SECRET'),
        this.credentials.decrypt(existing.refreshTokenEnc),
      );
      await this.persistToken(tenantId, refreshed);
      return refreshed.access_token;
    } catch (error) {
      // Alerta ERROR (não WARNING): a partir daqui o tenant fica sem acesso
      // válido ao Mercado Livre até alguém intervir (token não renova
      // sozinho de novo se o refresh_token em si foi revogado/expirou).
      this.alerts.emitAlert({
        source: 'MercadoLivreConnectionService',
        severity: 'ERROR',
        message: `Falha ao renovar token de acesso do Mercado Livre para tenant ${tenantId}`,
        context: { tenantId, expiresAt: existing.expiresAt.toISOString(), error: (error as Error).message },
      });
      throw error;
    }
  }

  // sellerId é necessário em toda chamada a /orders/search — devolvido em
  // texto puro (não é segredo, é só um identificador público do vendedor),
  // diferente de access/refresh token.
  async getSellerId(tenantId: string): Promise<string | null> {
    const existing = await this.connections.findByTenant(tenantId);
    return existing?.isActive ? existing.sellerId : null;
  }

  async listActiveTenantIds(): Promise<string[]> {
    const active = await this.connections.findAllActive();
    return active.map((c) => c.tenantId);
  }

  async disconnect(tenantId: string): Promise<void> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) throw new NotFoundException('Nenhuma conexão com o Mercado Livre encontrada para esta conta.');
    await this.connections.deactivate(tenantId);
  }

  async getStatus(tenantId: string): Promise<MercadoLivreConnectionStatus> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) return { connected: false, isActive: false, sellerId: null, expiresAt: null, lastRefreshedAt: null };
    return {
      connected: true,
      isActive: existing.isActive,
      sellerId: existing.sellerId,
      expiresAt: existing.expiresAt,
      lastRefreshedAt: existing.lastRefreshedAt,
    };
  }

  private async persistToken(tenantId: string, token: MlOAuthTokenResponse): Promise<void> {
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    await this.connections.upsert(tenantId, {
      sellerId: String(token.user_id),
      accessTokenEnc: this.credentials.encrypt(token.access_token),
      refreshTokenEnc: this.credentials.encrypt(token.refresh_token),
      tokenType: token.token_type,
      scope: token.scope ?? null,
      expiresAt,
    });
  }

  // `state` = payload {tenantId, issuedAt} criptografado com o MESMO
  // CredentialEncryptionService usado para os tokens (AES-256-GCM,
  // autenticado) — nunca um JWT/base64 simples, porque o objetivo aqui não
  // é só assinar (evitar adulteração), é também esconder o tenantId de
  // qualquer um que veja a URL de callback (logs de proxy, histórico do
  // navegador do vendedor). Ver docs/auth-security.md.
  private encodeState(tenantId: string): string {
    return this.credentials.encrypt(JSON.stringify({ tenantId, issuedAt: Date.now() }));
  }

  private decodeState(state: string): string {
    let payload: { tenantId?: unknown; issuedAt?: unknown };
    try {
      payload = JSON.parse(this.credentials.decrypt(state));
    } catch {
      throw new BadRequestException('Parâmetro state inválido ou adulterado.');
    }
    if (typeof payload.tenantId !== 'string' || typeof payload.issuedAt !== 'number') {
      throw new BadRequestException('Parâmetro state em formato inesperado.');
    }
    if (Date.now() - payload.issuedAt > STATE_MAX_AGE_MS) {
      throw new BadRequestException('Link de autorização expirado — reinicie o fluxo de conexão com o Mercado Livre.');
    }
    return payload.tenantId;
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new InternalServerErrorException(
        `Variável de ambiente ${name} não configurada — a integração OAuth2 do Mercado Livre não pode funcionar sem ela.`,
      );
    }
    return value;
  }
}
