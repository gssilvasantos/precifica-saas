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

  it('status paid sem shipping avançado -> PREPARANDO_ENVIO', () => {
    expect(mapMercadoLivreStatus({ status: 'paid' })).toBe('PREPARANDO_ENVIO');
  });

  it('status partially_paid -> PREPARANDO_ENVIO', () => {
    expect(mapMercadoLivreStatus({ status: 'partially_paid' })).toBe('PREPARANDO_ENVIO');
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
