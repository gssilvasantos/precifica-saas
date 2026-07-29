import { mapMercadoLivreStatus } from './mercado-livre-order-status.mapper';

describe('mapMercadoLivreStatus', () => {
  it('status cancelled -> CANCELADO', () => {
    expect(mapMercadoLivreStatus({ status: 'cancelled' })).toBe('CANCELADO');
  });

  it('status invalid -> CANCELADO', () => {
    expect(mapMercadoLivreStatus({ status: 'invalid' })).toBe('CANCELADO');
  });

  it('shippingStatus cancelled -> CANCELADO mesmo com status de pagamento ok', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'cancelled' })).toBe('CANCELADO');
  });

  it('shippingStatus delivered -> ENTREGUE', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'delivered' })).toBe('ENTREGUE');
  });

  it('shippingStatus shipped -> ENVIADO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'shipped' })).toBe('ENVIADO');
  });

  it('status paid sem confirmação de envio (fast path) -> APROVADO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid' })).toBe('APROVADO');
  });

  it('status paid com shippingStatus pending (ainda sem preparação confirmada) -> APROVADO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'pending' })).toBe('APROVADO');
  });

  it('status partially_paid sem confirmação de envio -> APROVADO', () => {
    expect(mapMercadoLivreStatus({ status: 'partially_paid' })).toBe('APROVADO');
  });

  it('shippingStatus handling (preparação confirmada) -> PREPARANDO_ENVIO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'handling' })).toBe('PREPARANDO_ENVIO');
  });

  it('shippingStatus ready_to_ship (preparação confirmada) -> PREPARANDO_ENVIO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'ready_to_ship' })).toBe('PREPARANDO_ENVIO');
  });

  it('shippingStatus not_delivered -> NAO_ENTREGUE', () => {
    expect(mapMercadoLivreStatus({ status: 'paid', shippingStatus: 'not_delivered' })).toBe('NAO_ENTREGUE');
  });

  it('status confirmed (aguardando pagamento) -> EM_ABERTO', () => {
    expect(mapMercadoLivreStatus({ status: 'confirmed' })).toBe('EM_ABERTO');
  });

  it('status payment_required -> EM_ABERTO (fail-safe)', () => {
    expect(mapMercadoLivreStatus({ status: 'payment_required' })).toBe('EM_ABERTO');
  });

  it('é case-insensitive', () => {
    expect(mapMercadoLivreStatus({ status: 'PAID', shippingStatus: 'DELIVERED' })).toBe('ENTREGUE');
  });
});
