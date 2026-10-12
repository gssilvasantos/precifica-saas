import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OLIST_CONNECTION_REPOSITORY,
  OlistConnectionRepository,
} from './ports/olist-connection-repository.port';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';
import { OlistV3ApiClient, OlistV3TokenResponse } from '../infrastructure/olist/olist-v3-api.client';

// Janela do `state` do OAuth2 — mesmo racional e mesmo valor do Mercado Livre.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Renova 5 min antes de vencer (latência de rede e diferença de relógio).
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;
// O refresh token do Olist dura ~24 h (observado no rm-catalogo). Se a resposta
// não informar a duração, assume o valor conservador em vez de deixar null.
const DEFAULT_REFRESH_TTL_SECONDS = 24 * 60 * 60;

export interface OlistV3ConnectionStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  connectedAt: Date | null;
}

// Ciclo de vida da credencial OAuth2 da API v3 do Olist (ADR 0003): autorizar,
// trocar o code, renovar e desconectar. Só esta camada vê token em claro; o
// repositório guarda sempre criptografado.
//
// Fica ATRÁS da flag OLIST_V3_ENABLED: desligada, toda rota devolve 503 com
// código estável e nada na v3 é chamado.
@Injectable()
export class OlistV3ConnectionService {
  private readonly logger = new Logger(OlistV3ConnectionService.name);

  // Renovação single-flight por tenant: o Olist pode rotacionar o refresh token a
  // cada renovação, então duas renovações simultâneas com o mesmo token fariam a
  // segunda falhar e poderiam invalidar a conexão inteira.
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    @Inject(OLIST_CONNECTION_REPOSITORY) private readonly connections: OlistConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: OlistV3ApiClient,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  assertAvailable(): void {
    if (!this.client.isEnabled()) {
      throw new ServiceUnavailableException({
        code: 'OLIST_V3_DISABLED',
        message: 'A integração com a API v3 do Olist está desligada neste ambiente.',
      });
    }
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'OLIST_V3_NOT_CONFIGURED',
        message: 'A integração com a API v3 do Olist está ligada, mas faltam variáveis de ambiente do aplicativo.',
      });
    }
  }

  buildAuthorizationUrl(tenantId: string): string {
    this.assertAvailable();
    return this.client.buildAuthorizeUrl(this.encodeState(tenantId));
  }

  // Chamado pelo callback público (sem JWT). O tenant vem do `state` criptografado.
  async handleCallback(code: string, state: string): Promise<void> {
    this.assertAvailable();
    const tenantId = this.decodeState(state);
    const token = await this.client.exchangeCode(code);
    // A rota é pública, então o interceptor abriu bypass de serviço. Reabre o
    // contexto no tenant do `state` para a gravação ficar sob RLS como qualquer outra.
    await TenantContextStore.run(tenantId, async () => {
      const saved = await this.persist(tenantId, token, true);
      if (!saved) {
        throw new BadRequestException({
          code: 'OLIST_V2_CONNECTION_REQUIRED',
          message: 'Conecte primeiro o token do Olist (conexão atual) antes de ligar a API v3.',
        });
      }
    });
    this.logger.log(`Conexão Olist v3 estabelecida para tenant ${tenantId}.`);
  }

  async getValidAccessToken(tenantId: string): Promise<string> {
    this.assertAvailable();
    const stored = await this.connections.findV3Tokens(tenantId);
    if (!stored) {
      throw new NotFoundException({
        code: 'OLIST_V3_NOT_CONNECTED',
        message: 'Esta conta ainda não conectou a API v3 do Olist.',
      });
    }

    if (stored.accessExpiresAt.getTime() - Date.now() > REFRESH_SAFETY_MARGIN_MS) {
      return this.credentials.decrypt(stored.accessTokenEnc);
    }

    if (stored.refreshExpiresAt && stored.refreshExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'OLIST_V3_RECONNECT_REQUIRED',
        message: 'A conexão com a API v3 do Olist expirou. Conecte novamente.',
      });
    }

    const inFlight = this.refreshing.get(tenantId);
    if (inFlight) return inFlight;

    const run = this.refreshNow(tenantId, stored.refreshTokenEnc, stored.accessExpiresAt).finally(() => {
      this.refreshing.delete(tenantId);
    });
    this.refreshing.set(tenantId, run);
    return run;
  }

  async disconnect(tenantId: string): Promise<void> {
    const stored = await this.connections.findV3Tokens(tenantId);
    if (!stored) throw new NotFoundException('Nenhuma conexão com a API v3 do Olist encontrada para esta conta.');
    await this.connections.clearV3Tokens(tenantId);
  }

  async getStatus(tenantId: string): Promise<OlistV3ConnectionStatus> {
    const enabled = this.client.isEnabled();
    const configured = this.client.isConfigured();
    const stored = enabled ? await this.connections.findV3Tokens(tenantId) : null;
    return {
      enabled,
      configured,
      connected: stored !== null,
      accessExpiresAt: stored?.accessExpiresAt ?? null,
      refreshExpiresAt: stored?.refreshExpiresAt ?? null,
      connectedAt: stored?.connectedAt ?? null,
    };
  }

  private async refreshNow(tenantId: string, refreshTokenEnc: string, previousExpiry: Date): Promise<string> {
    this.logger.log(`Access token Olist v3 do tenant ${tenantId} perto de vencer ou vencido — renovando.`);
    try {
      const refreshed = await this.client.refresh(this.credentials.decrypt(refreshTokenEnc));
      await this.persist(tenantId, refreshed, false);
      return refreshed.access_token;
    } catch (error) {
      // Daqui em diante a conta fica sem acesso à v3 até alguém reconectar: alerta ERROR.
      this.alerts.emitAlert({
        source: 'OlistV3ConnectionService',
        severity: 'ERROR',
        message: `Falha ao renovar token da API v3 do Olist para tenant ${tenantId}`,
        context: { tenantId, expiresAt: previousExpiry.toISOString(), error: (error as Error).message },
      });
      throw error;
    }
  }

  private persist(tenantId: string, token: OlistV3TokenResponse, markConnected: boolean): Promise<boolean> {
    const now = Date.now();
    return this.connections.saveV3Tokens(
      tenantId,
      {
        accessTokenEnc: this.credentials.encrypt(token.access_token),
        refreshTokenEnc: this.credentials.encrypt(token.refresh_token),
        accessExpiresAt: new Date(now + token.expires_in * 1000),
        refreshExpiresAt: new Date(now + (token.refresh_expires_in ?? DEFAULT_REFRESH_TTL_SECONDS) * 1000),
      },
      markConnected,
    );
  }

  // `state` = {tenantId, issuedAt} criptografado (AES-256-GCM autenticado): protege
  // contra adulteração e não expõe o tenantId na URL. Mesmo desenho do Mercado Livre.
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
      throw new BadRequestException('Link de autorização expirado — reinicie a conexão com o Olist.');
    }
    return payload.tenantId;
  }
}
