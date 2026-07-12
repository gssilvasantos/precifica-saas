import { mapNuvemshopStatus } from './nuvemshop-order-status.mapper';

describe('mapNuvemshopStatus', () => {
  it('mapeia status cancelled para CANCELADO independente de pagamento/envio', () => {
    expect(mapNuvemshopStatus({ status: 'cancelled', paymentStatus: 'paid', shippingStatus: 'shipped' })).toBe(
      'CANCELADO',
    );
  });

  it('mapeia shippingStatus delivered para ENTREGUE', () => {
    expect(mapNuvemshopStatus({ status: 'open', paymentStatus: 'paid', shippingStatus: 'delivered' })).toBe(
      'ENTREGUE',
    );
  });

  it('mapeia status closed (sem shippingStatus) para ENTREGUE', () => {
    expect(mapNuvemshopStatus({ status: 'closed' })).toBe('ENTREGUE');
  });

  it('mapeia shippingStatus shipped para ENVIADO', () => {
    expect(mapNuvemshopStatus({ status: 'open', paymentStatus: 'paid', shippingStatus: 'shipped' })).toBe('ENVIADO');
  });

  it('mapeia pagamento paid sem envio para PREPARANDO_ENVIO', () => {
    expect(mapNuvemshopStatus({ status: 'open', paymentStatus: 'paid' })).toBe('PREPARANDO_ENVIO');
  });

  it('mapeia pagamento partially_paid para PREPARANDO_ENVIO', () => {
    expect(mapNuvemshopStatus({ status: 'open', paymentStatus: 'partially_paid' })).toBe('PREPARANDO_ENVIO');
  });

  it('mapeia pagamento pending para EM_ABERTO', () => {
    expect(mapNuvemshopStatus({ status: 'open', paymentStatus: 'pending' })).toBe('EM_ABERTO');
  });

  it('mapeia ausência de payment/shipping status para EM_ABERTO (fail-safe)', () => {
    expect(mapNuvemshopStatus({ status: 'open' })).toBe('EM_ABERTO');
  });
});
