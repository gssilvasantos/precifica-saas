import { resolveEffectiveStatus } from './order-status-guard';

describe('resolveEffectiveStatus (Reestruturação do sync ML, 25-26/07/2026)', () => {
  it('pedido novo (previousStatus null): sempre aplica o status recebido', () => {
    expect(resolveEffectiveStatus(null, 'EM_ABERTO')).toBe('EM_ABERTO');
    expect(resolveEffectiveStatus(null, 'ENTREGUE')).toBe('ENTREGUE');
  });

  it('avança normalmente quando o novo estágio é igual ou posterior', () => {
    expect(resolveEffectiveStatus('EM_ABERTO', 'PREPARANDO_ENVIO')).toBe('PREPARANDO_ENVIO');
    expect(resolveEffectiveStatus('PREPARANDO_ENVIO', 'ENVIADO')).toBe('ENVIADO');
    expect(resolveEffectiveStatus('ENVIADO', 'ENVIADO')).toBe('ENVIADO');
  });

  it('NÃO regride: um pedido já ENVIADO/ENTREGUE (enriquecido) não volta pra PREPARANDO_ENVIO numa resync incremental sem informação nova de envio', () => {
    expect(resolveEffectiveStatus('ENVIADO', 'PREPARANDO_ENVIO')).toBe('ENVIADO');
    expect(resolveEffectiveStatus('ENTREGUE', 'PREPARANDO_ENVIO')).toBe('ENTREGUE');
    expect(resolveEffectiveStatus('ENTREGUE', 'ENVIADO')).toBe('ENTREGUE');
  });

  it('cancelamento é aplicado de qualquer estágio', () => {
    expect(resolveEffectiveStatus('EM_ABERTO', 'CANCELADO')).toBe('CANCELADO');
    expect(resolveEffectiveStatus('ENVIADO', 'CANCELADO')).toBe('CANCELADO');
  });

  it('CANCELADO é terminal — não "descancela" sozinho numa resync', () => {
    expect(resolveEffectiveStatus('CANCELADO', 'EM_ABERTO')).toBe('CANCELADO');
    expect(resolveEffectiveStatus('CANCELADO', 'PREPARANDO_ENVIO')).toBe('CANCELADO');
  });
});
