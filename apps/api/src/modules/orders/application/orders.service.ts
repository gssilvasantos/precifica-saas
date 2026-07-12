import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_REPOSITORY, OrderRepository } from './ports/order-repository.port';
import { AppDataMode, Order, OrderListFilters, OrderListPage, OrderStatusCounts } from '../domain/order.entity';
import { computeOrderMarginSummary, OrderMarginSummary } from '../domain/order-margin';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { OrderFinancialLine, OrderFinancialsReader, OrderItemForFulfillment } from '../../../shared/contracts/order-financials-reader.port';

// Camada de aplicação simples — sem regra de negócio própria além de
// delegar ao repositório e traduzir "não encontrado" em NotFoundException.
// Toda a lógica de sincronização/transição de status vive no
// OrderSyncOrchestrator; este service existe só para servir a camada HTTP
// (Task #71). getMarginSummary (Etapa 19) e listForPeriod (Etapa 20, ver
// `implements OrderFinancialsReader`) são as exceções — orquestram o
// fallback de custo (domain/order-margin.ts) buscando o custo ATUAL só dos
// SKUs que realmente precisam dele.
@Injectable()
export class OrdersService implements OrderFinancialsReader {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
  ) {}

  async findWithFilters(
    tenantId: string,
    filters: OrderListFilters,
    page: number,
    pageSize: number,
  ): Promise<OrderListPage> {
    return this.orders.findWithFilters(tenantId, filters, page, pageSize);
  }

  async countByStatus(tenantId: string, dataMode?: AppDataMode): Promise<OrderStatusCounts> {
    return this.orders.countByStatus(tenantId, dataMode);
  }

  async findById(tenantId: string, id: string): Promise<Order> {
    const order = await this.orders.findById(tenantId, id);
    if (!order) {
      throw new NotFoundException(`Pedido ${id} não encontrado.`);
    }
    return order;
  }

  // Etapa 19 — margem real do pedido, com o fallback de integridade de
  // dados pedido explicitamente: itens sem snapshot de custo (pedidos
  // sincronizados antes desta etapa, ou SKU nunca resolvido) usam o custo
  // ATUAL do produto como aproximação, nunca ficam com margem fabricada em
  // zero. Só consulta o catálogo para os SKUs que de fato precisam do
  // fallback — itens que já têm snapshot não geram nenhuma query extra.
  async getMarginSummary(tenantId: string, id: string): Promise<OrderMarginSummary> {
    const order = await this.findById(tenantId, id);
    const currentCostBySku = await this.resolveCurrentCostForFallback(tenantId, [order]);
    return computeOrderMarginSummary(order, currentCostBySku);
  }

  // Etapa 20 — implementação de OrderFinancialsReader, consumida pelo
  // FinancialOrchestrator (Financial Intelligence) para montar o DRE.
  // Reaproveita a MESMA função pura de fallback de custo da Etapa 19
  // (computeOrderMarginSummary), agora em lote: uma única consulta ao
  // catálogo por SKU que precisa de fallback em TODO o período — nunca uma
  // consulta por pedido nem por item, mesmo com centenas de pedidos.
  async listForPeriod(
    tenantId: string,
    dateFrom?: Date,
    dateTo?: Date,
    dataMode?: AppDataMode,
  ): Promise<OrderFinancialLine[]> {
    const orders = await this.orders.findAllForPeriod(tenantId, dateFrom, dateTo, dataMode);
    const currentCostBySku = await this.resolveCurrentCostForFallback(tenantId, orders);

    return orders.map((order) => {
      const margin = computeOrderMarginSummary(order, currentCostBySku);
      return {
        orderId: order.id,
        externalOrderId: order.externalOrderId,
        channelCode: order.channelCode,
        status: order.status,
        orderedAt: order.orderedAt,
        totalAmount: order.totalAmount,
        shippingAmount: order.shippingAmount,
        discountAmount: order.discountAmount,
        feeAmount: order.feeAmount,
        items: order.items.map((item, idx) => ({
          skuCode: item.skuCode,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
          taxAmount: item.taxAmount,
          costPriceUsed: margin.items[idx].costPriceUsed,
          costKnown: margin.items[idx].costSource !== 'UNKNOWN',
        })),
      };
    });
  }

  // Sprint 27 — implementação de OrderFinancialsReader.findItemsForOrders,
  // consumida por StockMovementAuditEventService (logistics-fulfillment)
  // para montar o checklist de bipagem. Delega direto ao repositório (uma
  // única query) — nenhuma lógica de fallback de custo aqui, diferente de
  // listForPeriod, porque bipagem não precisa de preço/custo nenhum.
  async findItemsForOrders(tenantId: string, orderIds: string[]): Promise<OrderItemForFulfillment[]> {
    return this.orders.findItemsByOrderIds(tenantId, orderIds);
  }

  // Extraído de getMarginSummary/listForPeriod — dado um conjunto de
  // pedidos, monta o mapa (skuCode -> custo efetivo atual) consultando o
  // catálogo SÓ para os SKUs de itens sem snapshot de custo, deduplicado.
  private async resolveCurrentCostForFallback(tenantId: string, orders: Order[]): Promise<Map<string, number>> {
    const skusNeedingFallback = new Set<string>();
    for (const order of orders) {
      for (const item of order.items) {
        if (item.costPrice === null && item.skuCode) {
          skusNeedingFallback.add(item.skuCode);
        }
      }
    }

    const currentCostBySku = new Map<string, number>();
    for (const skuCode of skusNeedingFallback) {
      const product = await this.catalog.findBySku(tenantId, skuCode);
      if (product) {
        currentCostBySku.set(skuCode, product.costPrice);
      }
    }
    return currentCostBySku;
  }
}
