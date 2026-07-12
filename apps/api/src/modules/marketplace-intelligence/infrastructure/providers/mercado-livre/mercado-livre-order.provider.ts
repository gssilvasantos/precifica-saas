import { Injectable, Logger } from '@nestjs/common';
import {
  AuthenticatedProvider,
  FetchContext,
  OrderCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
  RawOrderCandidate,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { MercadoLivreApiClient } from './mercado-livre-api.client';
import { normalizeMercadoLivreOrder } from './mercado-livre-order-normalizer';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// Segunda capacidade do Mercado Livre no hub de pedidos (Sprint 21) — classe
// SEPARADA de MercadoLivreFeeRuleProvider (mesmo racional de
// NuvemshopOrderProvider vs NuvemshopFeeRuleProvider: capacidades
// independentes, nada obriga viverem na mesma classe mesmo sendo o mesmo
// canal). Registrada em ORDER_CAPABLE_PROVIDERS (módulo Orders) — é a peça
// que prova que o hub de pedidos é "plug-and-play": nenhuma linha de
// OrderSyncOrchestrator/OrderProviderRegistry muda para o canal entrar.
//
// Sprint 22 — o gap de autenticação documentado no Sprint 21 (OAuth2 por
// vendedor não implementado) está resolvido: `ensureValidCredentials()` e
// `listTenantIdsToSync()` agora consultam `MercadoLivreConnectionService`
// (`MercadoLivreConnection`, ver docs/auth-security.md) em vez de lançar
// `NotImplementedException`. `getValidAccessToken()` já cuida do refresh
// automático — este provider nunca precisa saber se o token estava perto
// de vencer.
@Injectable()
export class MercadoLivreOrderProvider implements OrderCapableProvider, AuthenticatedProvider {
  readonly code = 'MERCADO_LIVRE_ORDERS';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.ORDERS];
  readonly authScope = 'TENANT' as const;

  private readonly logger = new Logger(MercadoLivreOrderProvider.name);

  constructor(
    private readonly client: MercadoLivreApiClient,
    private readonly connection: MercadoLivreConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — ver fetchOrders (mesmo padrão de NuvemshopOrderProvider)
  }

  async listTenantIdsToSync(): Promise<string[]> {
    return this.connection.listActiveTenantIds();
  }

  // Delega para MercadoLivreConnectionService — que já lança
  // NotFoundException se o tenant não tiver conexão ativa (mensagem clara,
  // vira log de FAILED no ProviderSyncLogRepository, mesma auditoria da
  // Sprint 21).
  async ensureValidCredentials(tenantId?: string): Promise<void> {
    await this.connection.getValidAccessToken(tenantId);
  }

  async fetchOrders(ctx: FetchContext): Promise<RawOrderCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('MercadoLivreOrderProvider chamado sem tenantId — pedido é sempre por vendedor, não há candidato global.');
      return [];
    }

    // getValidAccessToken já faz o refresh automático se necessário (item 2
    // do pedido da Sprint 22) — este provider nunca decide isso sozinho.
    const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
    const sellerId = await this.connection.getSellerId(ctx.tenantId);
    if (!sellerId) {
      // Defesa em profundidade: getValidAccessToken já teria lançado se a
      // conexão não existisse, mas sellerId é lido em uma segunda consulta
      // — nunca assumimos que ele existe só porque o token existiu.
      this.logger.warn(`Tenant ${ctx.tenantId}: conexão Mercado Livre sem sellerId resolvido — pulando sync de pedidos.`);
      return [];
    }

    const rawOrders = await this.client.fetchOrders(sellerId, accessToken, ctx.since);
    return rawOrders.map((raw) => normalizeMercadoLivreOrder(raw)).filter((o): o is RawOrderCandidate => o !== null);
  }
}
