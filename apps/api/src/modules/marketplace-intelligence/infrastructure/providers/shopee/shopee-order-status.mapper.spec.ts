import { mapShopeeOrderStatus } from './shopee-order-status.mapper';

describe('mapShopeeOrderStatus', () => {
  it('UNPAID -> EM_ABERTO', () => {
    expect(mapShopeeOrderStatus('UNPAID')).toBe('EM_ABERTO');
  });

  it('READY_TO_SHIP / PROCESSED / INVOICE_PENDING -> PREPARANDO_ENVIO', () => {
    expect(mapShopeeOrderStatus('READY_TO_SHIP')).toBe('PREPARANDO_ENVIO');
    expect(mapShopeeOrderStatus('PROCESSED')).toBe('PREPARANDO_ENVIO');
    expect(mapShopeeOrderStatus('INVOICE_PENDING')).toBe('PREPARANDO_ENVIO');
  });

  it('SHIPPED -> ENVIADO', () => {
    expect(mapShopeeOrderStatus('SHIPPED')).toBe('ENVIADO');
  });

  it('COMPLETED / TO_RETURN -> ENTREGUE', () => {
    expect(mapShopeeOrderStatus('COMPLETED')).toBe('ENTREGUE');
    expect(mapShopeeOrderStatus('TO_RETURN')).toBe('ENTREGUE');
  });

  it('CANCELLED / IN_CANCEL -> CANCELADO', () => {
    expect(mapShopeeOrderStatus('CANCELLED')).toBe('CANCELADO');
    expect(mapShopeeOrderStatus('IN_CANCEL')).toBe('CANCELADO');
  });

  it('status desconhecido cai no fallback conservador EM_ABERTO (nunca assume cancelado/entregue)', () => {
    expect(mapShopeeOrderStatus('SOME_FUTURE_STATUS')).toBe('EM_ABERTO');
  });

  it('é case-insensitive', () => {
    expect(mapShopeeOrderStatus('shipped')).toBe('ENVIADO');
  });
});
