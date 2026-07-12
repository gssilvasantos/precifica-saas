import { computeOrderItemMargin, computeOrderMarginSummary, resolveItemCostPrice } from './order-margin';
import { Order, OrderItem } from './order.entity';

function buildItem(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'item-1',
    orderId: 'order-1',
    skuCode: 'SKU-1',
    externalSku: 'EXT-SKU-1',
    productName: 'Produto',
    quantity: 2,
    unitPrice: 50,
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

describe('resolveItemCostPrice', () => {
  it('usa o snapshot do item quando presente (ITEM_SNAPSHOT)', () => {
    expect(resolveItemCostPrice({ costPrice: 30 }, 999)).toEqual({ costPriceUsed: 30, costSource: 'ITEM_SNAPSHOT' });
  });

  it('fallback: usa o custo atual do produto quando o snapshot é nulo (CURRENT_PRODUCT)', () => {
    expect(resolveItemCostPrice({ costPrice: null }, 45)).toEqual({ costPriceUsed: 45, costSource: 'CURRENT_PRODUCT' });
  });

  it('sem snapshot e sem custo atual disponível: UNKNOWN, nunca fabrica um número', () => {
    expect(resolveItemCostPrice({ costPrice: null }, null)).toEqual({ costPriceUsed: null, costSource: 'UNKNOWN' });
  });
});

describe('computeOrderItemMargin', () => {
  it('calcula margem usando o snapshot do item quando presente', () => {
    const item = buildItem({ costPrice: 20, quantity: 2, totalPrice: 100 }); // custo total 40, margem 60 (60%)

    const margin = computeOrderItemMargin(item, 999);

    expect(margin.costSource).toBe('ITEM_SNAPSHOT');
    expect(margin.costPriceUsed).toBe(20);
    expect(margin.marginAmount).toBe(60);
    expect(margin.marginPct).toBeCloseTo(60);
  });

  it('fallback: item sem snapshot usa o custo atual do produto', () => {
    const item = buildItem({ costPrice: null, quantity: 2, totalPrice: 100 });

    const margin = computeOrderItemMargin(item, 25); // custo total 50, margem 50 (50%)

    expect(margin.costSource).toBe('CURRENT_PRODUCT');
    expect(margin.costPriceUsed).toBe(25);
    expect(margin.marginAmount).toBe(50);
    expect(margin.marginPct).toBeCloseTo(50);
  });

  it('sem nenhum custo disponível: margem null, nunca zero fabricado', () => {
    const item = buildItem({ costPrice: null });

    const margin = computeOrderItemMargin(item, null);

    expect(margin.costSource).toBe('UNKNOWN');
    expect(margin.marginAmount).toBeNull();
    expect(margin.marginPct).toBeNull();
  });

  it('totalPrice zero: marginPct null (evita divisão por zero), marginAmount ainda calculado', () => {
    const item = buildItem({ costPrice: 10, quantity: 1, totalPrice: 0 });

    const margin = computeOrderItemMargin(item, null);

    expect(margin.marginAmount).toBe(-10);
    expect(margin.marginPct).toBeNull();
  });
});

describe('computeOrderMarginSummary', () => {
  it('agrega margem de múltiplos itens, todos com snapshot', () => {
    const items = [
      buildItem({ id: 'i1', skuCode: 'SKU-1', costPrice: 20, quantity: 1, totalPrice: 100 }), // margem 80
      buildItem({ id: 'i2', skuCode: 'SKU-2', costPrice: 30, quantity: 1, totalPrice: 100 }), // margem 70
    ];
    const order = buildOrder(items);

    const summary = computeOrderMarginSummary(order, new Map());

    expect(summary.itemsWithUnknownCost).toBe(0);
    expect(summary.totalMarginAmount).toBe(150);
    expect(summary.totalMarginPct).toBeCloseTo(75); // 150 / 200 * 100
  });

  it('usa o fallback (custo atual por SKU) só para itens sem snapshot', () => {
    const items = [
      buildItem({ id: 'i1', skuCode: 'SKU-1', costPrice: 20, quantity: 1, totalPrice: 100 }), // snapshot: margem 80
      buildItem({ id: 'i2', skuCode: 'SKU-2', costPrice: null, quantity: 1, totalPrice: 100 }), // fallback: custo atual 40 -> margem 60
    ];
    const order = buildOrder(items);
    const currentCostBySku = new Map([['SKU-2', 40]]);

    const summary = computeOrderMarginSummary(order, currentCostBySku);

    expect(summary.items[0].costSource).toBe('ITEM_SNAPSHOT');
    expect(summary.items[1].costSource).toBe('CURRENT_PRODUCT');
    expect(summary.itemsWithUnknownCost).toBe(0);
    expect(summary.totalMarginAmount).toBe(140);
  });

  it('itens com custo totalmente desconhecido são excluídos dos totais, nunca contados como margem zero', () => {
    const items = [
      buildItem({ id: 'i1', skuCode: 'SKU-1', costPrice: 20, quantity: 1, totalPrice: 100 }), // margem 80
      buildItem({ id: 'i2', skuCode: 'SKU-2', costPrice: null, quantity: 1, totalPrice: 100 }), // sem fallback disponível
    ];
    const order = buildOrder(items);

    const summary = computeOrderMarginSummary(order, new Map()); // SKU-2 não está no mapa

    expect(summary.itemsWithUnknownCost).toBe(1);
    // Só o item 1 entra no total: margem 80 sobre receita 100, não 80 sobre 200.
    expect(summary.totalMarginAmount).toBe(80);
    expect(summary.totalMarginPct).toBeCloseTo(80);
  });

  it('pedido sem nenhum item com custo conhecido: totais null, não zero', () => {
    const items = [buildItem({ id: 'i1', skuCode: 'SKU-1', costPrice: null })];
    const order = buildOrder(items);

    const summary = computeOrderMarginSummary(order, new Map());

    expect(summary.itemsWithUnknownCost).toBe(1);
    expect(summary.totalMarginAmount).toBeNull();
    expect(summary.totalMarginPct).toBeNull();
  });
});
