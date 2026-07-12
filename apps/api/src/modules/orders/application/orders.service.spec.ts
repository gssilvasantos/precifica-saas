import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderRepository } from './ports/order-repository.port';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { Order, OrderItem } from '../domain/order.entity';

function buildItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    orderId: 'order-1',
    skuCode: 'SKU-1',
    externalSku: 'EXT-SKU-1',
    productName: 'Produto',
    quantity: 1,
    unitPrice: 100,
    totalPrice: 100,
    taxAmount: null,
    costPrice: null,
    ...overrides,
  };
}

function buildOrder(items: OrderItem[]): Order {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    channelCode: 'NUVEMSHOP',
    externalOrderId: 'EXT-1',
    status: 'PREPARANDO_ENVIO',
    externalStatus: 'paid',
    subtotalAmount: 100,
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount: 100,
    feeAmount: 0,
    netAmount: 100,
    currency: 'BRL',
    fiscalResponsibility: 'SELLER',
    buyerTaxId: null,
    invoiceNumber: null,
    shippingDeadlineAt: null,
    orderedAt: new Date('2026-07-01'),
    paidAt: new Date('2026-07-01'),
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    syncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    isDemo: false,
    items,
  };
}

describe('OrdersService', () => {
  function buildService(order: Order | null, allOrders: Order[] = []) {
    const orderRepository: jest.Mocked<OrderRepository> = {
      upsert: jest.fn(),
      findById: jest.fn().mockResolvedValue(order),
      findWithFilters: jest.fn(),
      countByStatus: jest.fn(),
      findAllForPeriod: jest.fn().mockResolvedValue(allOrders),
      deleteDemoOrders: jest.fn(),
      findItemsByOrderIds: jest.fn().mockResolvedValue([]),
    };
    const catalog: jest.Mocked<ProductCatalogReader> = {
      findBySku: jest.fn(),
    };
    const service = new OrdersService(orderRepository, catalog);
    return { service, orderRepository, catalog };
  }

  describe('findById', () => {
    it('lança NotFoundException quando o pedido não existe', async () => {
      const { service } = buildService(null);
      await expect(service.findById('tenant-1', 'order-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMarginSummary', () => {
    it('não consulta o catálogo quando todos os itens já têm snapshot de custo', async () => {
      const order = buildOrder([buildItem({ costPrice: 20 })]);
      const { service, catalog } = buildService(order);

      const summary = await service.getMarginSummary('tenant-1', 'order-1');

      expect(catalog.findBySku).not.toHaveBeenCalled();
      expect(summary.items[0].costSource).toBe('ITEM_SNAPSHOT');
      expect(summary.totalMarginAmount).toBe(80);
    });

    it('Etapa 19 — fallback: item sem snapshot consulta o custo ATUAL do produto via ProductCatalogReader', async () => {
      const order = buildOrder([buildItem({ skuCode: 'SKU-1', costPrice: null })]);
      const { service, catalog } = buildService(order);
      catalog.findBySku.mockResolvedValue({
        productId: 'prod-1',
        skuCode: 'SKU-1',
        name: 'Produto',
        costPrice: 35,
        productCostPrice: 35,
        packagingCostPrice: null,
        desiredMarginPct: 20,
        minimumMarginPct: 8,
        autoRepricingEnabled: false,
        packagingId: null,
        isKit: false,
      });

      const summary = await service.getMarginSummary('tenant-1', 'order-1');

      expect(catalog.findBySku).toHaveBeenCalledWith('tenant-1', 'SKU-1');
      expect(summary.items[0].costSource).toBe('CURRENT_PRODUCT');
      expect(summary.items[0].costPriceUsed).toBe(35);
      expect(summary.totalMarginAmount).toBe(65);
    });

    it('não duplica consulta ao catálogo quando dois itens do pedido compartilham o mesmo SKU', async () => {
      const order = buildOrder([
        buildItem({ id: 'i1', skuCode: 'SKU-1', costPrice: null }),
        buildItem({ id: 'i2', skuCode: 'SKU-1', costPrice: null }),
      ]);
      const { service, catalog } = buildService(order);
      catalog.findBySku.mockResolvedValue({
        productId: 'prod-1',
        skuCode: 'SKU-1',
        name: 'Produto',
        costPrice: 10,
        productCostPrice: 10,
        packagingCostPrice: null,
        desiredMarginPct: 20,
        minimumMarginPct: 8,
        autoRepricingEnabled: false,
        packagingId: null,
        isKit: false,
      });

      await service.getMarginSummary('tenant-1', 'order-1');

      expect(catalog.findBySku).toHaveBeenCalledTimes(1);
    });

    it('SKU sem produto no catálogo (nunca cadastrado): margem UNKNOWN, não fabrica número', async () => {
      const order = buildOrder([buildItem({ skuCode: 'SKU-FANTASMA', costPrice: null })]);
      const { service, catalog } = buildService(order);
      catalog.findBySku.mockResolvedValue(null);

      const summary = await service.getMarginSummary('tenant-1', 'order-1');

      expect(summary.items[0].costSource).toBe('UNKNOWN');
      expect(summary.itemsWithUnknownCost).toBe(1);
      expect(summary.totalMarginAmount).toBeNull();
    });
  });

  describe('listForPeriod (Etapa 20 — implementação de OrderFinancialsReader)', () => {
    it('delega ao repositório com o período informado e mapeia para OrderFinancialLine', async () => {
      const order = buildOrder([buildItem({ costPrice: 20, quantity: 2, totalPrice: 100 })]);
      const { service, orderRepository } = buildService(null, [order]);
      const dateFrom = new Date('2026-07-01');
      const dateTo = new Date('2026-07-31');

      const lines = await service.listForPeriod('tenant-1', dateFrom, dateTo);

      expect(orderRepository.findAllForPeriod).toHaveBeenCalledWith('tenant-1', dateFrom, dateTo, undefined);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        orderId: 'order-1',
        externalOrderId: 'EXT-1',
        channelCode: 'NUVEMSHOP',
        totalAmount: 100,
        feeAmount: 0,
      });
      expect(lines[0].items[0]).toMatchObject({ costPriceUsed: 20, costKnown: true });
    });

    it('consulta o catálogo UMA VEZ POR SKU em todo o período, mesmo com vários pedidos/itens compartilhando o SKU', async () => {
      const orderA = buildOrder([buildItem({ id: 'a1', skuCode: 'SKU-X', costPrice: null })]);
      orderA.id = 'order-a';
      const orderB = buildOrder([buildItem({ id: 'b1', skuCode: 'SKU-X', costPrice: null })]);
      orderB.id = 'order-b';

      const { service, catalog } = buildService(null, [orderA, orderB]);
      catalog.findBySku.mockResolvedValue({
        productId: 'prod-1',
        skuCode: 'SKU-X',
        name: 'Produto',
        costPrice: 15,
        productCostPrice: 15,
        packagingCostPrice: null,
        desiredMarginPct: 20,
        minimumMarginPct: 8,
        autoRepricingEnabled: false,
        packagingId: null,
        isKit: false,
      });

      const lines = await service.listForPeriod('tenant-1');

      expect(catalog.findBySku).toHaveBeenCalledTimes(1);
      expect(lines[0].items[0].costPriceUsed).toBe(15);
      expect(lines[1].items[0].costPriceUsed).toBe(15);
    });

    it('item sem custo conhecido (snapshot ausente e SKU não cadastrado): costKnown=false, nunca fabrica um valor', async () => {
      const order = buildOrder([buildItem({ skuCode: 'SKU-FANTASMA', costPrice: null })]);
      const { service, catalog } = buildService(null, [order]);
      catalog.findBySku.mockResolvedValue(null);

      const lines = await service.listForPeriod('tenant-1');

      expect(lines[0].items[0]).toMatchObject({ costPriceUsed: null, costKnown: false });
    });

    it('Audit Mode: repassa o dataMode informado direto ao repositório (REAL/DEMO nunca se misturam)', async () => {
      const order = buildOrder([buildItem({ costPrice: 20 })]);
      order.isDemo = true;
      const { service, orderRepository } = buildService(null, [order]);

      await service.listForPeriod('tenant-1', undefined, undefined, 'DEMO');

      expect(orderRepository.findAllForPeriod).toHaveBeenCalledWith('tenant-1', undefined, undefined, 'DEMO');
    });
  });
});
