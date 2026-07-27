import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  AuthenticatedProvider,
  FetchContext,
  OrderCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
  RawOrderCandidate,
} from '../../../../../shared/contracts/marketplace-provider.contract';
import { ShopeeApiClient } from './shopee-api-client';
import { normalizeShopeeOrder } from './shopee-order-normalizer';
import { ShopeeConnectionService } from '../../../application/shopee-connection.service';

// Terceira capacidade da Shopee no hub de pedidos, mesmo racional de
// MercadoLivreOrderProvider: classe SEPARADA de nenhum outro provider Shopee
// hoje (só existe a camada de conexão, ver ShopeeConnectionService) —
// registrada em ORDER_CAPABLE_PROVIDERS (módulo Orders), nenhuma linha de
// OrderSyncOrchestrator/OrderProviderRegistry muda para este canal entrar.
//
// Handshake de conexão (auth_partner -> callback -> token/get -> get_shop_info)
// CONFIRMADO em produção (27/07/2026, ver docs/auth-security.md seção 9) —
// mas a captura de PEDIDOS em si (get_order_list/get_order_detail) é nova
// aqui e nunca foi exercitada contra a Shopee real. Mesma sequência de
// maturidade já usada com o Mercado Livre: primeiro provar que a
// autenticação funciona de ponta a ponta, só depois construir o que
// consome ela — ver AVISO DE HONESTIDADE em shopee-api-client.ts e
// shopee-order-normalizer.ts.
@Injectable()
export class ShopeeOrderProvider implements OrderCapableProvider, AuthenticatedProvider {
  readonly code = 'SHOPEE_ORDERS';
  readonly marketplaceCode = 'SHOPEE';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.ORDERS];
  readonly authScope = 'TENANT' as const;

  private readonly logger = new Logger(ShopeeOrderProvider.name);

  constructor(
    private readonly client: ShopeeApiClient,
    private readonly connection: ShopeeConnectionService,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — ver fetchOrders (mesmo padrão de MercadoLivreOrderProvider)
  }

  async listTenantIdsToSync(): Promise<string[]> {
    return this.connection.listActiveTenantIds();
  }

  // Delega para ShopeeConnectionService — que já lança NotFoundException se
  // o tenant não tiver conexão ativa (vira log de FAILED no
  // ProviderSyncLogRepository, mesma auditoria do Mercado Livre).
  async ensureValidCredentials(tenantId?: string): Promise<void> {
    await this.connection.getValidAccessToken(tenantId);
  }

  async fetchOrders(ctx: FetchContext): Promise<RawOrderCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('ShopeeOrderProvider chamado sem tenantId — pedido é sempre por loja, não há candidato global.');
      return [];
    }

    // getValidAccessToken já faz o refresh automático se necessário — este
    // provider nunca decide isso sozinho (mesmo racional do Mercado Livre).
    const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
    const shopId = await this.connection.getShopId(ctx.tenantId);
    if (!shopId) {
      // Defesa em profundidade: getValidAccessToken já teria lançado se a
      // conexão não existisse, mas shopId é lido em uma segunda consulta —
      // nunca assumimos que ele existe só porque o token existiu.
      this.logger.warn(`Tenant ${ctx.tenantId}: conexão Shopee sem shopId resolvido — pulando sync de pedidos.`);
      return [];
    }

    const since = ctx.since ?? new Date(0);
    // Backfill filtra por create_time (pedidos CRIADOS na janela); incremental
    // usa update_time de propósito — mesmo racional do Mercado Livre: quer
    // pegar pedido antigo que só mudou de status agora.
    const timeRangeField = ctx.isFirstSync ? 'create_time' : 'update_time';

    const orderSns = await this.client.fetchOrderList(
      this.requireEnv('SHOPEE_PARTNER_ID'),
      this.requireEnv('SHOPEE_PARTNER_KEY'),
      shopId,
      accessToken,
      since,
      timeRangeField,
    );
    if (orderSns.length === 0) {
      this.logger.log(`Sync Shopee tenant=${ctx.tenantId}: nenhum pedido encontrado na janela (${timeRangeField}).`);
      return [];
    }

    const rawOrders = await this.client.fetchOrderDetail(
      this.requireEnv('SHOPEE_PARTNER_ID'),
      this.requireEnv('SHOPEE_PARTNER_KEY'),
      shopId,
      accessToken,
      orderSns,
    );

    const candidates = rawOrders.map((raw) => normalizeShopeeOrder(raw));
    this.logger.log(`Sync Shopee tenant=${ctx.tenantId}: ${orderSns.length} pedido(s) encontrado(s), ${rawOrders.length} detalhado(s) (${timeRangeField}).`);

    return candidates.filter((o): o is RawOrderCandidate => o !== null);
  }

  // .trim() — mesmo racional defensivo de ShopeeConnectionService/ShopeeHandshakeService
  // (ver comentário lá): espaço/quebra de linha escondida ao colar a chave
  // num painel como o do Render muda a chave HMAC sem aparecer na tela.
  // Duplicado aqui (em vez de compartilhado) de propósito, mesmo racional
  // arquitetural das outras classes Shopee: capacidades independentes,
  // nada obriga viverem na mesma classe ou compartilharem um helper privado.
  private requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new InternalServerErrorException(`Variável de ambiente ${name} não configurada — a integração da Shopee não pode funcionar sem ela.`);
    }
    return value;
  }
}
