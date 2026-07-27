import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { AuthStrategy } from '../../../shared/contracts/auth-strategy.contract';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import { ShopeeApiClient, ShopeeOAuthTokenResponse } from '../infrastructure/providers/shopee/shopee-api-client';
import { SHOPEE_CONNECTION_REPOSITORY, ShopeeConnectionRepository } from './ports/shopee-connection-repository.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';

// Janela de tolerância do `state` — mesmo racional de
// MercadoLivreConnectionService (proteção contra link de autorização
// esquecido/reenviado). 10 minutos é folgado o bastante para o lojista
// completar o login/aprovação real no Shopee sem fricção.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Margem de segurança do refresh automático — mesmo racional do Mercado
// Livre, mas o access_token da Shopee expira bem mais rápido (~4h contra
// ~6h do ML), então a margem é a MESMA em valor absoluto (5 min), mas
// proporcionalmente mais apertada. Ainda assim folgada o bastante para
// cobrir latência de rede/clock skew.
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export interface ShopeeConnectionStatus {
  connected: boolean;
  isActive: boolean;
  shopId: string | null;
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
}

// Integração Shopee Open Platform (27/07/2026) — gerencia o ciclo de vida
// completo da credencial por tenant: autorização, troca de code, renovação
// automática e desconexão. Implementa AuthStrategy (mesmo contrato de
// MercadoLivreConnectionService) com type='API_KEY_HMAC' (a Shopee assina
// cada chamada com HMAC-SHA256, não usa Bearer/OAuth2 clássico — ver
// ShopeeApiClient).
//
// AVISO DE HONESTIDADE: ver o cabeçalho de shopee-api-client.ts — o fluxo
// completo (auth_partner -> callback -> token/get -> access_token/get)
// segue a documentação pública do Shopee Open Platform e nunca foi
// exercitado contra uma chamada real neste sandbox. Precisa ser validado no
// primeiro handshake real feito pelo usuário (app "Developing", credenciais
// de teste).
@Injectable()
export class ShopeeConnectionService implements AuthStrategy {
  readonly type = 'API_KEY_HMAC' as const;
  readonly scope = 'TENANT' as const;

  private readonly logger = new Logger(ShopeeConnectionService.name);

  constructor(
    @Inject(SHOPEE_CONNECTION_REPOSITORY) private readonly connections: ShopeeConnectionRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly client: ShopeeApiClient,
    // Mesmo racional de MercadoLivreConnectionService: falha silenciosa na
    // renovação automática é o pior tipo de falha aqui — sem alerta, a
    // conexão do tenant simplesmente para de funcionar sem ninguém notar.
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  // Passo 1 — nenhuma chamada de rede fica pendente aqui (a assinatura
  // HMAC é síncrona), só monta a URL para a qual o FRONTEND deve
  // redirecionar o navegador do lojista. `state` carrega o tenantId de
  // forma criptografada, embutido no `redirect` (a Shopee não tem um
  // parâmetro `state` nativo como o Mercado Livre — ver aviso em
  // ShopeeApiClient.buildAuthPartnerUrl).
  buildAuthorizationUrl(tenantId: string): string {
    const state = this.encodeState(tenantId);
    const redirectUri = `${this.requireEnv('SHOPEE_REDIRECT_URI')}?state=${encodeURIComponent(state)}`;
    return this.client.buildAuthPartnerUrl(this.requireEnv('SHOPEE_PARTNER_ID'), this.requireEnv('SHOPEE_PARTNER_KEY'), redirectUri);
  }

  // Passo 2 — chamado pelo controller de callback (público, sem guard) com
  // o `code`/`shop_id`/`state` que a Shopee devolve no redirect do
  // navegador do lojista. Decodifica o state (valida integridade/freshness),
  // troca o code por tokens e persiste criptografado.
  async handleCallback(code: string, shopId: string, state: string): Promise<void> {
    const tenantId = this.decodeState(state);
    const token = await this.client.exchangeCodeForToken(
      this.requireEnv('SHOPEE_PARTNER_ID'),
      this.requireEnv('SHOPEE_PARTNER_KEY'),
      code,
      shopId,
    );
    await this.persistToken(tenantId, shopId, token);
    this.logger.log(`Conexão Shopee estabelecida para tenant ${tenantId} (loja ${shopId}).`);
  }

  // Renova AUTOMATICAMENTE antes de devolver o token — mesmo racional de
  // MercadoLivreConnectionService.getValidAccessToken. Implementa a
  // assinatura de AuthStrategy.
  async getValidAccessToken(tenantId?: string): Promise<string> {
    if (!tenantId) {
      throw new BadRequestException('ShopeeConnectionService.getValidAccessToken exige tenantId (authScope TENANT).');
    }
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing || !existing.isActive) {
      throw new NotFoundException(`Tenant ${tenantId} não tem conexão ativa com a Shopee.`);
    }

    const msUntilExpiry = existing.expiresAt.getTime() - Date.now();
    if (msUntilExpiry > REFRESH_SAFETY_MARGIN_MS) {
      return this.credentials.decrypt(existing.accessTokenEnc);
    }

    this.logger.log(
      `Access token do tenant ${tenantId} (Shopee) ${msUntilExpiry <= 0 ? 'expirado' : 'perto de expirar'} — renovando automaticamente.`,
    );
    try {
      const refreshed = await this.client.refreshAccessToken(
        this.requireEnv('SHOPEE_PARTNER_ID'),
        this.requireEnv('SHOPEE_PARTNER_KEY'),
        this.credentials.decrypt(existing.refreshTokenEnc),
        existing.shopId,
      );
      await this.persistToken(tenantId, existing.shopId, refreshed);
      return refreshed.access_token;
    } catch (error) {
      // Alerta ERROR: a partir daqui o tenant fica sem acesso válido à
      // Shopee até alguém intervir — o refresh_token da Shopee expira em
      // ~1 mês; se o refresh falhar depois disso, só reautorização manual
      // resolve (não é um erro transitório, nunca some sozinho).
      this.alerts.emitAlert({
        source: 'ShopeeConnectionService',
        severity: 'ERROR',
        message: `Falha ao renovar token de acesso da Shopee para tenant ${tenantId}`,
        context: { tenantId, expiresAt: existing.expiresAt.toISOString(), error: (error as Error).message },
      });
      throw error;
    }
  }

  // shopId é necessário em toda chamada autenticada à API da Shopee —
  // devolvido em texto puro (não é segredo), diferente de access/refresh
  // token.
  async getShopId(tenantId: string): Promise<string | null> {
    const existing = await this.connections.findByTenant(tenantId);
    return existing?.isActive ? existing.shopId : null;
  }

  async listActiveTenantIds(): Promise<string[]> {
    const active = await this.connections.findAllActive();
    return active.map((c) => c.tenantId);
  }

  async disconnect(tenantId: string): Promise<void> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) throw new NotFoundException('Nenhuma conexão com a Shopee encontrada para esta conta.');
    await this.connections.deactivate(tenantId);
  }

  async getStatus(tenantId: string): Promise<ShopeeConnectionStatus> {
    const existing = await this.connections.findByTenant(tenantId);
    if (!existing) return { connected: false, isActive: false, shopId: null, expiresAt: null, lastRefreshedAt: null };
    return {
      connected: true,
      isActive: existing.isActive,
      shopId: existing.shopId,
      expiresAt: existing.expiresAt,
      lastRefreshedAt: existing.lastRefreshedAt,
    };
  }

  private async persistToken(tenantId: string, shopId: string, token: ShopeeOAuthTokenResponse): Promise<void> {
    const expiresAt = new Date(Date.now() + token.expire_in * 1000);
    await this.connections.upsert(tenantId, {
      shopId,
      accessTokenEnc: this.credentials.encrypt(token.access_token),
      refreshTokenEnc: this.credentials.encrypt(token.refresh_token),
      expiresAt,
    });
  }

  // `state` = payload {tenantId, issuedAt} criptografado com o MESMO
  // CredentialEncryptionService usado para os tokens — mesmo racional de
  // MercadoLivreConnectionService.encodeState (nunca um JWT/base64 simples,
  // esconde o tenantId de logs de proxy/histórico do navegador).
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
      throw new BadRequestException('Link de autorização expirado — reinicie o fluxo de conexão com a Shopee.');
    }
    return payload.tenantId;
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new InternalServerErrorException(
        `Variável de ambiente ${name} não configurada — a integração da Shopee não pode funcionar sem ela.`,
      );
    }
    return value;
  }
}
