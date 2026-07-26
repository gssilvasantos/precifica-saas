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
import {
  extractOrderCreatedAt,
  extractOrderStatus,
  extractShippingId,
  normalizeMercadoLivreOrder,
} from './mercado-livre-order-normalizer';
import { MercadoLivreConnectionService } from '../../../application/mercado-livre-connection.service';

// Só vale a pena consultar o status REAL do envio (uma chamada de API a
// mais por pedido, ver MercadoLivreApiClient.fetchShipmentStatus) para
// pedidos que já chegaram a este estágio — pedido em aberto/aguardando
// pagamento/cancelado não tem shipping relevante ainda. Reduz
// drasticamente o número de consultas extras num backfill grande.
const STATUSES_WORTH_CHECKING_SHIPMENT = new Set(['paid', 'partially_paid']);

// Bug de produção (25/07/2026) — mesmo depois de corrigir o campo de data do
// backfill (date_created em vez de date_last_updated, ver
// MercadoLivreApiClient), uma conta com volume real alto (~4.500 pedidos
// criados nos últimos 90 dias, dos quais ~4.244 pagos) tornava o
// enriquecimento de status de envio inviável: a 1 req/s (rate limit
// conservador, ver mercado-livre-api.client.ts), só essa fase levaria mais
// de 1 hora — muito além do que uma chamada síncrona (ou o Render free
// tier) aguenta, e o sync nunca chegava a persistir um pedido sequer.
// Trade-off consciente, confirmado com o usuário: pedido pago há mais de
// ENRICHMENT_WINDOW_MS quase certamente já foi enviado/entregue — não vale
// gastar uma chamada de API nele a cada backfill. Só pedidos pagos CRIADOS
// dentro dessa janela recente recebem a consulta extra; os demais entram
// com o status derivado só do que a busca já traz (fallback antigo,
// ver mercado-livre-order-normalizer.ts) — podem ficar temporariamente
// menos precisos, mas o sync deixa de travar. Aceito como limitação
// documentada, não escondida.
const ENRICHMENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

    // Bug de produção (25/07/2026, ver README e aviso em
    // MercadoLivreApiClient.fetchOrders) — backfill (primeira sync) precisa
    // filtrar por `date_created` (pedidos CRIADOS na janela), não
    // `date_last_updated` (qualquer pedido TOCADO, volume muito maior e
    // imprevisível). Incremental continua em `date_last_updated` de
    // propósito — quer pegar pedido antigo que só mudou de status agora.
    const dateField = ctx.isFirstSync ? 'date_created' : 'date_last_updated';
    const rawOrders = await this.client.fetchOrders(sellerId, accessToken, ctx.since, dateField);
    const enrichmentCutoff = Date.now() - ENRICHMENT_WINDOW_MS;

    // Bug de produção (24/07/2026) — ver aviso de honestidade em
    // mercado-livre-order-normalizer.ts: `shipping.status` não vem no
    // payload de `/orders/search` (é só uma referência), então todo pedido
    // pago ficava para sempre em "Preparando envio", mesmo já
    // enviado/entregue há meses. Aqui, para cada pedido PAGO e RECENTE (ver
    // ENRICHMENT_WINDOW_MS acima), consultamos o status real do envio
    // (`/shipments/{id}`) antes de normalizar — as chamadas passam pelo
    // MESMO RateLimiter do client (nunca estouram a cota configurada), mas
    // ainda assim são uma chamada extra por pedido; por isso os dois
    // filtros acima (status + idade) — pedido em aberto/cancelado, ou pago
    // há muito tempo, não precisa consultar nada.
    let enrichedCount = 0;
    const candidates = await Promise.all(
      rawOrders.map(async (raw) => {
        const shippingId = extractShippingId(raw);
        const orderStatus = extractOrderStatus(raw);
        const createdAt = extractOrderCreatedAt(raw);
        const isRecentEnough = createdAt ? createdAt.getTime() >= enrichmentCutoff : true; // sem data confiável: mais seguro tentar do que ignorar
        let resolvedShippingStatus: string | undefined;

        if (shippingId && STATUSES_WORTH_CHECKING_SHIPMENT.has(orderStatus) && isRecentEnough) {
          enrichedCount++;
          const shipment = await this.client.fetchShipmentStatus(shippingId, accessToken);
          resolvedShippingStatus = shipment?.status;
        }

        return normalizeMercadoLivreOrder(raw, resolvedShippingStatus);
      }),
    );
    this.logger.log(
      `Sync ML tenant=${ctx.tenantId}: ${rawOrders.length} pedido(s) buscado(s) (${dateField}), ${enrichedCount} enriquecido(s) com status real de envio (janela de ${Math.round(ENRICHMENT_WINDOW_MS / (24 * 60 * 60 * 1000))} dias).`,
    );

    return candidates.filter((o): o is RawOrderCandidate => o !== null);
  }
}
