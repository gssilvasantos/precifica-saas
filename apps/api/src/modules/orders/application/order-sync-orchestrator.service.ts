import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { OrderProviderRegistry } from './order-provider-registry.service';
import { ORDER_REPOSITORY, OrderRepository } from './ports/order-repository.port';
import { OrderUpsertData } from '../domain/order.entity';
import { ORDER_EVENTS, OrderCancelledEvent, OrderPaidEvent, OrderReadyForFulfillmentEvent } from '../domain/order-events';
import { determineOrderTransitionEvents } from '../domain/order-transition-events';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Pipeline por provider: Fetch (paginação já resolvida DENTRO do adapter,
// ver marketplace-provider.contract.ts) -> Resolver SKU interno por item
// (best effort) -> Upsert idempotente -> Detectar transição de status ->
// Emitir eventos. Mesma forma de RuleSyncOrchestrator, mais simples (sem
// versionamento/governança — pedido é dado transacional, não regra que
// precisa de aprovação humana).
@Injectable()
export class OrderSyncOrchestrator {
  private readonly logger = new Logger(OrderSyncOrchestrator.name);

  constructor(
    private readonly registry: OrderProviderRegistry,
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    private readonly events: EventEmitter2,
    // Observabilidade básica (Fase de Conexão Real) — todo caminho de falha
    // deste orquestrador (por pedido individual OU por tenant/provider
    // inteiro) emite um alerta técnico, para que uma sincronização quebrada
    // não dependa de alguém checar o log manualmente.
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  async syncProvider(providerCode: string): Promise<void> {
    const provider = this.registry.findByCode(providerCode);
    if (!provider) {
      this.logger.warn(`Provider de pedidos ${providerCode} não registrado — pulando.`);
      return;
    }

    // ORDERS é sempre por tenant (cada loja/conta tem seus próprios
    // pedidos) — diferente de FEE_RULES, que pode ser global. Um provider de
    // pedidos sem listTenantIdsToSync não tem como saber de quem sincronizar.
    if (!provider.listTenantIdsToSync) {
      this.logger.warn(`Provider de pedidos ${providerCode} não implementa listTenantIdsToSync() — pulando.`);
      return;
    }

    // Bypass estreito só para descobrir quais tenants este provider atende —
    // cada tenant reabre seu próprio contexto antes de tocar dado de pedido
    // (ver docs/row-level-security-architecture.md, seção 3.3).
    const tenantIds = await TenantContextStore.runAsService(() => provider.listTenantIdsToSync!());
    for (const tenantId of tenantIds) {
      await TenantContextStore.run(tenantId, () => this.syncTenant(provider.code, provider.marketplaceCode, tenantId, provider));
    }
  }

  private async syncTenant(
    providerCode: string,
    marketplaceCode: string,
    tenantId: string,
    provider: { fetchOrders: (ctx: { marketplaceCode: string; tenantId: string; since?: Date }) => Promise<import('../../../shared/contracts/marketplace-provider.contract').RawOrderCandidate[]> },
  ): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(providerCode, correlationId);
    let candidatesFound = 0;
    let candidatesApplied = 0;

    try {
      // MVP: sem watermark persistido por tenant ainda — busca uma janela
      // fixa de segurança (7 dias) a cada execução. Suficiente para o
      // volume de um MVP; a otimização natural é persistir "última data
      // sincronizada" por (tenant, provider), mesmo padrão de
      // NuvemshopConnection.lastSyncedAt.
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const rawOrders = await provider.fetchOrders({ marketplaceCode, tenantId, since });
      candidatesFound = rawOrders.length;
      await this.health.recordSuccess(providerCode);

      for (const raw of rawOrders) {
        try {
          await this.upsertAndEmit(tenantId, marketplaceCode, raw);
          candidatesApplied++;
        } catch (error) {
          const message = `Falha ao processar pedido ${raw.externalOrderId} (${marketplaceCode}, tenant ${tenantId}): ${(error as Error).message}`;
          this.logger.error(message);
          // Falha por pedido individual não interrompe o lote (os demais
          // pedidos do provider seguem sendo processados) — por isso é
          // WARNING, não ERROR: sinaliza que algo precisa de atenção, sem
          // implicar que a sincronização inteira falhou.
          this.alerts.emitAlert({
            source: 'OrderSyncOrchestrator',
            severity: 'WARNING',
            message: `Falha ao processar pedido ${raw.externalOrderId}`,
            context: { tenantId, marketplaceCode, providerCode, externalOrderId: raw.externalOrderId, error: (error as Error).message },
          });
        }
      }

      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound, candidatesApplied });
    } catch (error) {
      await this.health.recordFailure(providerCode, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound,
        candidatesApplied,
        errorDetails: (error as Error).message,
      });
      const message = `Sync de pedidos de ${providerCode} (tenant ${tenantId}) falhou: ${(error as Error).message}`;
      this.logger.error(message);
      // Falha no fetch/no provider inteiro: o lote inteiro deste
      // tenant/provider não foi sincronizado — ERROR, para diferenciar de
      // uma falha isolada em um único pedido.
      this.alerts.emitAlert({
        source: 'OrderSyncOrchestrator',
        severity: 'ERROR',
        message: `Sync de pedidos de ${providerCode} falhou`,
        context: { tenantId, providerCode, candidatesFound, candidatesApplied, error: (error as Error).message },
      });
    }
  }

  private async upsertAndEmit(
    tenantId: string,
    channelCode: string,
    raw: import('../../../shared/contracts/marketplace-provider.contract').RawOrderCandidate,
  ): Promise<void> {
    // Resolução de SKU best-effort: casa o identificador bruto do canal
    // contra o catálogo interno via PRODUCT_CATALOG_READER — mesma porta que
    // o Pricing Engine já consome, reaproveitada aqui só para "esse SKU
    // existe no meu catálogo?". Item some sem match não bloqueia o pedido —
    // fica com skuCode nulo (mesmo padrão de referência solta usado em
    // ChannelListing/CompetitiveOpportunity).
    // Etapa 19 (Orquestração de Custos): o MESMO lookup de catálogo que
    // resolve skuCode já devolve o custo efetivo do produto
    // (ProductCatalogSummary.costPrice = Product.costPrice + Packaging.costPrice)
    // — aproveitamos para gravar um SNAPSHOT do custo no item, no momento do
    // pedido. Isso nunca vem do canal (raw/RawOrderItemCandidate): custo de
    // aquisição é dado NOSSO, não do marketplace. Item sem match no catálogo
    // fica sem costPrice, igual já ficava sem skuCode — o fallback para
    // esses casos vive em OrdersService.getMarginSummary (domain/order-margin.ts).
    const items = await Promise.all(
      raw.items.map(async (item) => {
        const product = await this.catalog.findBySku(tenantId, item.externalSku);
        return { ...item, skuCode: product?.skuCode, costPrice: product?.costPrice };
      }),
    );

    const upsertData: OrderUpsertData = {
      tenantId,
      channelCode,
      externalOrderId: raw.externalOrderId,
      status: raw.status,
      externalStatus: raw.externalStatus,
      subtotalAmount: raw.subtotalAmount,
      shippingAmount: raw.shippingAmount,
      discountAmount: raw.discountAmount,
      totalAmount: raw.totalAmount,
      feeAmount: raw.feeAmount,
      netAmount: raw.netAmount,
      currency: raw.currency,
      fiscalResponsibility: raw.fiscalResponsibility,
      buyerTaxId: raw.buyerTaxId,
      invoiceNumber: raw.invoiceNumber,
      shippingDeadlineAt: raw.shippingDeadlineAt,
      orderedAt: raw.orderedAt,
      paidAt: raw.paidAt,
      shippedAt: raw.shippedAt,
      deliveredAt: raw.deliveredAt,
      cancelledAt: raw.cancelledAt,
      rawPayload: raw.rawPayload,
      items,
    };

    const result = await this.orders.upsert(upsertData);
    const transitionEvents = determineOrderTransitionEvents(result.previousStatus, result.order.status);

    for (const event of transitionEvents) {
      if (event === 'PAID') {
        const payload: OrderPaidEvent = {
          tenantId,
          orderId: result.order.id,
          channelCode,
          externalOrderId: result.order.externalOrderId,
          totalAmount: result.order.totalAmount,
          netAmount: result.order.netAmount,
          paidAt: result.order.paidAt ?? result.order.orderedAt,
        };
        this.events.emit(ORDER_EVENTS.PAID, payload);
      }
      if (event === 'CANCELLED') {
        const payload: OrderCancelledEvent = {
          tenantId,
          orderId: result.order.id,
          channelCode,
          externalOrderId: result.order.externalOrderId,
          cancelledAt: result.order.cancelledAt ?? new Date(),
        };
        this.events.emit(ORDER_EVENTS.CANCELLED, payload);
      }
      if (event === 'READY_FOR_FULFILLMENT') {
        const payload: OrderReadyForFulfillmentEvent = {
          tenantId,
          orderId: result.order.id,
          channelCode,
          externalOrderId: result.order.externalOrderId,
          skuCodes: result.order.items.map((i) => i.skuCode).filter((s): s is string => !!s),
        };
        this.events.emit(ORDER_EVENTS.READY_FOR_FULFILLMENT, payload);
      }
    }
  }
}
