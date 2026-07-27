import { normalizeShopeeOrder } from './shopee-order-normalizer';

describe('normalizeShopeeOrder', () => {
  it('devolve null para payload vazio/inválido', () => {
    expect(normalizeShopeeOrder(null)).toBeNull();
    expect(normalizeShopeeOrder(undefined)).toBeNull();
    expect(normalizeShopeeOrder('string')).toBeNull();
  });

  it('devolve null quando order_sn está ausente', () => {
    expect(normalizeShopeeOrder({ order_status: 'UNPAID' })).toBeNull();
  });

  it('normaliza um pedido completo, mapeando status e itens', () => {
    const createTime = Math.floor(Date.now() / 1000) - 3600;
    const payTime = Math.floor(Date.now() / 1000) - 1800;

    const result = normalizeShopeeOrder({
      order_sn: 'ORDER-123',
      order_status: 'SHIPPED',
      total_amount: 150.5,
      currency: 'BRL',
      create_time: createTime,
      pay_time: payTime,
      item_list: [
        { model_sku: 'SKU-A', item_name: 'Produto A', model_quantity_purchased: 2, model_discounted_price: 50 },
        { item_sku: 'SKU-B', item_name: 'Produto B', model_quantity_purchased: 1, model_original_price: 50.5 },
      ],
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      externalOrderId: 'ORDER-123',
      status: 'ENVIADO',
      externalStatus: 'SHIPPED',
      totalAmount: 150.5,
      subtotalAmount: 150.5,
      feeAmount: 0,
      netAmount: 150.5,
      currency: 'BRL',
      shippingAmount: 0,
      discountAmount: 0,
    });
    expect(result!.orderedAt.getTime()).toBe(createTime * 1000);
    expect(result!.paidAt?.getTime()).toBe(payTime * 1000);
    expect(result!.shippedAt).toBeUndefined();
    expect(result!.deliveredAt).toBeUndefined();
    expect(result!.cancelledAt).toBeUndefined();
    expect(result!.items).toEqual([
      { externalSku: 'SKU-A', productName: 'Produto A', quantity: 2, unitPrice: 50, totalPrice: 100 },
      { externalSku: 'SKU-B', productName: 'Produto B', quantity: 1, unitPrice: 50.5, totalPrice: 50.5 },
    ]);
  });

  it('sem pay_time, paidAt fica undefined (nunca fabrica uma data)', () => {
    const result = normalizeShopeeOrder({
      order_sn: 'ORDER-456',
      order_status: 'UNPAID',
      total_amount: 10,
      create_time: Math.floor(Date.now() / 1000),
      item_list: [],
    });

    expect(result!.paidAt).toBeUndefined();
    expect(result!.status).toBe('EM_ABERTO');
    expect(result!.items).toEqual([]);
  });

  it('item sem model_sku nem item_sku é descartado (sem SKU não há candidato válido)', () => {
    const result = normalizeShopeeOrder({
      order_sn: 'ORDER-789',
      order_status: 'UNPAID',
      total_amount: 10,
      create_time: Math.floor(Date.now() / 1000),
      item_list: [{ item_name: 'Sem SKU', model_quantity_purchased: 1 }],
    });

    expect(result!.items).toEqual([]);
  });
});
