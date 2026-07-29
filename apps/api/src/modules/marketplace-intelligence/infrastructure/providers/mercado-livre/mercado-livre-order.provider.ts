import { Injectable, Logger } from '@nestjs/common';
import {
  AuthenticatedProvider,
  FetchContext,
  OrderCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
  RawOrderCandidate,
  ShippingLabelCapableProvider,
  ShippingLabelResult,
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
// Sprint 22 — OAuth2 por vendedor (docs/auth-security.md): `ensureValidCredentials()`
// e `listTenantIdsToSync()` consultam `MercadoLivreConnectionService`, que
// também cuida do refresh automático de token.
//
// REESTRUTURAÇÃO DO SYNC (25-26/07/2026, ver README, "Reestruturação do sync
// ML") — mudança de arquitetura, não apenas mais um ajuste de bug: este
// provider NÃO consulta mais o status real de envio (GET /shipments/{id})
// durante fetchOrders(). Antes fazia isso inline, um `Promise.all` por
// pedido pago recente (ver histórico no README) — o que tornava o tempo
// total de fetchOrders() proporcional ao volume de pedidos pagos da janela,
// inviável em qualquer hospedagem sem processo de longa duração em segundo
// plano (Render free tier hiberna por inatividade de requisição HTTP — ver
// README). Comprovado em produção: mesmo depois de limitar o enriquecimento
// a pedidos pagos dos últimos 30 dias, o log permanente de conclusão de
// fetchOrders() NUNCA apareceu nos logs — a fase de enriquecimento sozinha
// já excedia a janela de atividade do Render.
//
// Agora fetchOrders() só BUSCA e NORMALIZA — sempre rápido, custo
// proporcional ao número de PÁGINAS da busca (não ao número de pedidos
// pagos), nunca faz uma chamada de rede por pedido. Todo pedido pago entra
// com o status-fallback PREPARANDO_ENVIO (ver mapMercadoLivreStatus) e fica
// imediatamente PERSISTIDO pelo OrderSyncOrchestrator — o vendedor já vê o
// pedido na worklist, mesmo que o status de envio ainda não esteja
// confirmado.
//
// O enriquecimento de status de envio virou uma responsabilidade SEPARADA,
// RESUMÍVEL e limitada por lote: MercadoLivreShipmentEnrichmentJob (módulo
// orders/infrastructure/scheduler), que a cada execução processa um número
// pequeno e fixo de pedidos "PREPARANDO_ENVIO ainda não conferidos"
// (Order.shippingStatusCheckedAt IS NULL — ver domain/order.entity.ts e o
// índice composto em schema.prisma). O progresso fica gravado NO BANCO, por
// pedido, nunca num cursor em memória — uma interrupção a qualquer momento
// (inclusive a hibernação do Render) perde no máximo o lote em andamento,
// nunca o trabalho já persistido. Isso é o que torna o sync funcional em
// QUALQUER hospedagem, inclusive a gratuita: cada execução (busca OU
// enriquecimento) processa um pedaço pequeno e delimitado, nunca tudo de
// uma vez.
//
// Ver domain/order-status-guard.ts para o cuidado correspondente do lado do
// repositório: como fetchOrders() agora nunca resolve o status real de
// envio, uma resync incremental (que roda a cada poucos minutos) precisa
// NUNCA regredir um pedido já confirmado ENVIADO/ENTREGUE de volta pro
// fallback PREPARANDO_ENVIO.
@Injectable()
export class MercadoLivreOrderProvider implements OrderCapableProvider, AuthenticatedProvider, ShippingLabelCapableProvider {
  readonly code = 'MERCADO_LIVRE_ORDERS';
  readonly marketplaceCode = 'MERCADO_LIVRE';
  readonly sourceType = 'OFFICIAL_API' as const;
  // Fase 5 (Expedição em lote, 29/07/2026) — SHIPPING_LABEL adicionada aqui
  // (não uma classe nova) porque buscar a etiqueta de um pedido já existente
  // reaproveita exatamente a mesma conexão/token de ORDERS, mesmo racional de
  // "capacidade nova na classe existente do canal" já usado pelo resto desta
  // base quando a capacidade é sobre o MESMO recurso (pedido).
  readonly capabilities = [ProviderCapability.ORDERS, ProviderCapability.SHIPPING_LABEL];
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

    // getValidAccessToken já faz o refresh automático se necessário — este
    // provider nunca decide isso sozinho.
    const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
    const sellerId = await this.connection.getSellerId(ctx.tenantId);
    if (!sellerId) {
      // Defesa em profundidade: getValidAccessToken já teria lançado se a
      // conexão não existisse, mas sellerId é lido em uma segunda consulta
      // — nunca assumimos que ele existe só porque o token existiu.
      this.logger.warn(`Tenant ${ctx.tenantId}: conexão Mercado Livre sem sellerId resolvido — pulando sync de pedidos.`);
      return [];
    }

    // Backfill (primeira sync) filtra por `date_created` (pedidos CRIADOS na
    // janela); incremental continua em `date_last_updated` de propósito —
    // quer pegar pedido antigo que só mudou de status agora. Ver README e
    // aviso em MercadoLivreApiClient.fetchOrders.
    const dateField = ctx.isFirstSync ? 'date_created' : 'date_last_updated';
    const rawOrders = await this.client.fetchOrders(sellerId, accessToken, ctx.since, dateField);

    // Normalização SEM consulta de envio (ver aviso de reestruturação acima)
    // — sempre rápido, nunca uma chamada de rede por pedido.
    const candidates = rawOrders.map((raw) => normalizeMercadoLivreOrder(raw));
    this.logger.log(
      `Sync ML tenant=${ctx.tenantId}: ${rawOrders.length} pedido(s) buscado(s) (${dateField}) — status de envio será conferido separadamente por MercadoLivreShipmentEnrichmentJob.`,
    );

    return candidates.filter((o): o is RawOrderCandidate => o !== null);
  }

  // Fase 5 (Expedição em lote) — busca o shipment_id + tracking_number reais
  // do pedido e monta a URL da etiqueta (Mercado Envios). Nunca lança: todo
  // caminho de falha vira { success: false, message } (mesmo padrão de
  // createListing do MercadoLivreListingProvider), porque um pedido do lote
  // sem envio nativo ainda resolvido não deve travar a geração de etiqueta
  // dos DEMAIS pedidos do mesmo lote.
  async getShippingLabel(ctx: FetchContext, externalOrderId: string): Promise<ShippingLabelResult> {
    if (!ctx.tenantId) {
      return { success: false, message: 'Etiqueta Mercado Envios exige tenantId — não há candidato global.' };
    }
    const accessToken = await this.connection.getValidAccessToken(ctx.tenantId);
    const info = await this.client.fetchOrderShippingInfo(externalOrderId, accessToken);
    if (!info.shipmentId) {
      return { success: false, message: 'Pedido ainda sem envio (Mercado Envios) vinculado — tente novamente mais tarde.' };
    }
    return {
      success: true,
      trackingCode: info.trackingNumber ?? undefined,
      labelUrl: this.client.buildShippingLabelUrl(info.shipmentId),
    };
  }
}
