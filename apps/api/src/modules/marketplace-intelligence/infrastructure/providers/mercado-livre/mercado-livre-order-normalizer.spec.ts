import { normalizeMercadoLivreOrder } from './mercado-livre-order-normalizer';

function buildRawOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123456,
    status: 'paid',
    date_created: '2026-07-01T10:00:00.000-04:00',
    date_closed: '2026-07-01T10:05:00.000-04:00',
    total_amount: 150,
    currency_id: 'BRL',
    shipping: { status: 'pending' },
    order_items: [
      { item: { id: 'MLB1', seller_sku: 'SKU-1', title: 'Produto Teste' }, quantity: 2, unit_price: 75, sale_fee: 10 },
    ],
    ...overrides,
  };
}

describe('normalizeMercadoLivreOrder', () => {
  it('mapeia campos básicos do pedido', () => {
    const result = normalizeMercadoLivreOrder(buildRawOrder());

    expect(result).toMatchObject({
      externalOrderId: '123456',
      status: 'PREPARANDO_ENVIO',
      totalAmount: 150,
      currency: 'BRL',
    });
  });

  it('soma sale_fee dos itens em feeAmount e deduz de netAmount', () => {
    const result = normalizeMercadoLivreOrder(buildRawOrder());

    expect(result?.feeAmount).toBe(10);
    expect(result?.netAmount).toBe(140);
  });

  it('sem sale_fee no payload: feeAmount fica 0, nunca inventa valor', () => {
    const raw = buildRawOrder({
      total_amount: 100,
      order_items: [{ item: { id: 'MLB1', seller_sku: 'SKU-1' }, quantity: 1, unit_price: 100 }],
    });

    const result = normalizeMercadoLivreOrder(raw);

    expect(result?.feeAmount).toBe(0);
    expect(result?.netAmount).toBe(100);
  });

  it('mapeia item com quantidade e preço unitário para totalPrice calculado', () => {
    const result = normalizeMercadoLivreOrder(buildRawOrder());

    expect(result?.items[0]).toMatchObject({ externalSku: 'SKU-1', quantity: 2, unitPrice: 75, totalPrice: 150 });
  });

  it('item sem seller_sku cai no id do anúncio como externalSku', () => {
    const raw = buildRawOrder({ order_items: [{ item: { id: 'MLB999' }, quantity: 1, unit_price: 50 }] });

    const result = normalizeMercadoLivreOrder(raw);

    expect(result?.items[0].externalSku).toBe('MLB999');
  });

  it('shipping status shipped -> ENVIADO, sem fabricar shippedAt', () => {
    const raw = buildRawOrder({ status: 'paid', shipping: { status: 'shipped' } });

    const result = normalizeMercadoLivreOrder(raw);

    expect(result?.status).toBe('ENVIADO');
    expect(result?.shippedAt).toBeUndefined();
  });

  it('status cancelled -> CANCELADO', () => {
    const raw = buildRawOrder({ status: 'cancelled' });

    const result = normalizeMercadoLivreOrder(raw);

    expect(result?.status).toBe('CANCELADO');
  });

  it('sem id: retorna null (não é um pedido válido)', () => {
    expect(normalizeMercadoLivreOrder({})).toBeNull();
  });

  it('payload não-objeto: retorna null', () => {
    expect(normalizeMercadoLivreOrder(null)).toBeNull();
    expect(normalizeMercadoLivreOrder('string')).toBeNull();
  });

  it('preserva rawPayload para auditoria', () => {
    const raw = buildRawOrder();
    const result = normalizeMercadoLivreOrder(raw);

    expect(result?.rawPayload).toBe(raw);
  });
});
