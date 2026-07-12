import { determineOrderTransitionEvents } from './order-transition-events';

describe('determineOrderTransitionEvents', () => {
  it('dispara PAID quando previousStatus é null e newStatus já chega além de EM_ABERTO (pedido novo já pago)', () => {
    expect(determineOrderTransitionEvents(null, 'FATURADO')).toEqual(['PAID']);
  });

  it('não dispara nada quando pedido novo chega EM_ABERTO', () => {
    expect(determineOrderTransitionEvents(null, 'EM_ABERTO')).toEqual([]);
  });

  it('dispara PAID ao sair de EM_ABERTO pela primeira vez', () => {
    expect(determineOrderTransitionEvents('EM_ABERTO', 'PREPARANDO_ENVIO')).toEqual(['PAID', 'READY_FOR_FULFILLMENT']);
  });

  it('não dispara PAID de novo em uma transição que já tinha saído de EM_ABERTO antes', () => {
    expect(determineOrderTransitionEvents('PREPARANDO_ENVIO', 'FATURADO')).toEqual([]);
  });

  it('dispara CANCELLED ao transicionar para CANCELADO', () => {
    expect(determineOrderTransitionEvents('EM_ABERTO', 'CANCELADO')).toEqual(['CANCELLED']);
  });

  it('não dispara CANCELLED de novo se já estava CANCELADO', () => {
    expect(determineOrderTransitionEvents('CANCELADO', 'CANCELADO')).toEqual([]);
  });

  it('dispara READY_FOR_FULFILLMENT ao entrar em PREPARANDO_ENVIO', () => {
    expect(determineOrderTransitionEvents('EM_ABERTO', 'PREPARANDO_ENVIO')).toContain('READY_FOR_FULFILLMENT');
  });

  it('não dispara READY_FOR_FULFILLMENT se já estava em PREPARANDO_ENVIO', () => {
    expect(determineOrderTransitionEvents('PREPARANDO_ENVIO', 'PREPARANDO_ENVIO')).toEqual([]);
  });

  it('EM_ABERTO -> CANCELADO nunca dispara PAID junto com CANCELLED', () => {
    expect(determineOrderTransitionEvents('EM_ABERTO', 'CANCELADO')).not.toContain('PAID');
  });
});
