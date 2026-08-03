import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ORDER_REPOSITORY, OrderRepository } from './ports/order-repository.port';
import { AppDataMode, Order, OrderListFilters, OrderListPage, OrderStatusCounts } from '../domain/order.entity';
import { computeOrderMarginSummary, OrderMarginSummary } from '../domain/order-margin';
import { PRODUCT_CATALOG_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { OrderFinancialLine, OrderFinancialsReader, OrderItemForFulfillment } from '../../../shared/contracts/order-financials-reader.port';
import { OrderFiscalData, OrderFiscalReader } from '../../../shared/contracts/order-fiscal-reader.port';
import { CommissionLineDto, OrderCommissionWriter } from '../../../shared/contracts/order-commission-writer.port';
import { MonthlyRevenue, MonthlyRevenueReader } from '../../../shared/contracts/monthly-revenue-reader.port';

// Camada de aplicação simples — sem regra de negócio própria além de
// delegar ao repositório e traduzir "não encontrado" em NotFoundException.
// Toda a lógica de sincronização/transição de status vive no
// OrderSyncOrchestrator; este service existe só para servir a camada HTTP
// (Task #71). getMarginSummary (Etapa 19) e listForPeriod (Etapa 20, ver
// `implements OrderFinancialsReader`) são as exceções — orquestram o
// fallback de custo (domain/order-margin.ts) buscando o custo ATUAL só dos
// SKUs que realmente precisam dele.
@Injectable()
export class OrdersService
  implements OrderFinancialsReader, OrderFiscalReader, OrderCommissionWriter, MonthlyRevenueReader
{
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orders: OrderRepository,
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
  ) {}

  // --- MonthlyRevenueReader (Tax Intelligence, 02/08/2026) ---
  //
  // Delegação pura: a agregação acontece no banco. Meses sem pedido NÃO
  // aparecem no resultado — traduzir ausência em zero é decisão de quem
  // consome, porque só ele sabe desde quando existe cobertura (firstOrderAt).
  sumByMonth(tenantId: string, from: Date, to: Date): Promise<MonthlyRevenue[]> {
    return this.orders.sumRevenueByMonth(tenantId, from, to);
  }

  firstOrderAt(tenantId: string): Promise<Date | null> {
    return this.orders.findFirstOrderDate(tenantId);
  }

  async findWithFilters(
    tenantId: string,
    filters: OrderListFilters,
    page: number,
    pageSize: number,
  ): Promise<OrderListPage> {
    return this.orders.findWithFilters(tenantId, filters, page, pageSize);
  }

  async countByStatus(tenantId: string, dataMode?: AppDataMode, channelCode?: string): Promise<OrderStatusCounts> {
    return this.orders.countByStatus(tenantId, dataMode, channelCode);
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

  // Fase 3 (benchmark Tiny ERP) — implementação de OrderFiscalReader,
  // consumida pelo FiscalInvoiceService (módulo fiscal) para montar o
  // payload de emissão de NF-e sem duplicar o acesso a Order. Reaproveita o
  // MESMO findById usado pela camada HTTP — sem lógica extra, só a
  // tradução pro DTO autocontido (ver order-fiscal-reader.port.ts).
  async getForFiscalEmission(tenantId: string, orderId: string): Promise<OrderFiscalData | null> {
    const order = await this.orders.findById(tenantId, orderId);
    if (!order) return null;
    return {
      orderId: order.id,
      channelCode: order.channelCode,
      externalOrderId: order.externalOrderId,
      status: order.status,
      buyerTaxId: order.buyerTaxId,
      totalAmount: order.totalAmount,
      shippingAmount: order.shippingAmount,
      discountAmount: order.discountAmount,
      items: order.items.map((item) => ({
        skuCode: item.skuCode,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
      })),
    };
  }

  // Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
  // 29/07/2026) — implementação de OrderCommissionWriter, consumida pelo
  // Sellers (CommissionService). Delega direto ao repositório — toda a
  // regra de negócio (validar vendedor ativo, calcular a comissão via
  // computeCommission, decidir quando gerar a conta a pagar) mora no
  // CommissionService, nunca aqui: OrdersService só resolve/persiste os
  // dados do PEDIDO, nunca conhece Vendedor nem AccountsPayable.
  findItemForCommission(tenantId: string, orderId: string, itemId: string): Promise<{ id: string; totalPrice: number } | null> {
    return this.orders.findItemForCommission(tenantId, orderId, itemId);
  }

  assignVendedorToItem(
    tenantId: string,
    orderId: string,
    itemId: string,
    data: { vendedorId: string; comissaoAliquotaPct: number; comissaoValor: number },
  ): Promise<{ id: string; totalPrice: number } | null> {
    return this.orders.assignVendedorToItem(tenantId, orderId, itemId, data);
  }

  findCommissionLines(
    tenantId: string,
    vendedorId: string,
    options?: { dateFrom?: Date; dateTo?: Date; onlyPending?: boolean },
  ): Promise<CommissionLineDto[]> {
    return this.orders.findCommissionLines(tenantId, vendedorId, options);
  }

  markCommissionsPaid(tenantId: string, orderItemIds: string[], paidAt: Date): Promise<number> {
    return this.orders.markCommissionsPaid(tenantId, orderItemIds, paidAt);
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
