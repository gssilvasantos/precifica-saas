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

  it('APROVADO entra na escada linear normal, entre EM_ABERTO e PREPARANDO_ENVIO', () => {
    expect(resolveEffectiveStatus('EM_ABERTO', 'APROVADO')).toBe('APROVADO');
    expect(resolveEffectiveStatus('APROVADO', 'PREPARANDO_ENVIO')).toBe('PREPARANDO_ENVIO');
    expect(resolveEffectiveStatus('PREPARANDO_ENVIO', 'APROVADO')).toBe('PREPARANDO_ENVIO'); // não regride
  });

  it('NAO_ENTREGUE só é aplicado a partir de ENVIADO (sinal incoerente antes disso é ignorado)', () => {
    expect(resolveEffectiveStatus('ENVIADO', 'NAO_ENTREGUE')).toBe('NAO_ENTREGUE');
    expect(resolveEffectiveStatus('PREPARANDO_ENVIO', 'NAO_ENTREGUE')).toBe('PREPARANDO_ENVIO');
    expect(resolveEffectiveStatus('EM_ABERTO', 'NAO_ENTREGUE')).toBe('EM_ABERTO');
  });

  it('NAO_ENTREGUE não é terminal: uma reentrega pode levar de volta a ENVIADO ou direto a ENTREGUE', () => {
    expect(resolveEffectiveStatus('NAO_ENTREGUE', 'ENVIADO')).toBe('ENVIADO');
    expect(resolveEffectiveStatus('NAO_ENTREGUE', 'ENTREGUE')).toBe('ENTREGUE');
    expect(resolveEffectiveStatus('NAO_ENTREGUE', 'PREPARANDO_ENVIO')).toBe('NAO_ENTREGUE'); // não regride antes de ENVIADO
  });

  it('cancelamento é aplicado mesmo a partir de NAO_ENTREGUE', () => {
    expect(resolveEffectiveStatus('NAO_ENTREGUE', 'CANCELADO')).toBe('CANCELADO');
  });
});
