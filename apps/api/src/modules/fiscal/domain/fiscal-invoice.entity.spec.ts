import { buildFocusRef, canCancel, canEmit, FiscalInvoice } from './fiscal-invoice.entity';

describe('canEmit', () => {
  it('rejeita pedido EM_ABERTO', () => {
    expect(canEmit('EM_ABERTO', []).ok).toBe(false);
  });

  it('rejeita pedido CANCELADO', () => {
    expect(canEmit('CANCELADO', []).ok).toBe(false);
  });

  it('aceita pedido APROVADO sem notas existentes', () => {
    expect(canEmit('APROVADO', []).ok).toBe(true);
  });

  it('rejeita se já existe nota PENDENTE/PROCESSANDO/AUTORIZADA', () => {
    expect(canEmit('APROVADO', [{ status: 'PENDENTE' }] as Pick<FiscalInvoice, 'status'>[]).ok).toBe(false);
    expect(canEmit('APROVADO', [{ status: 'PROCESSANDO' }] as Pick<FiscalInvoice, 'status'>[]).ok).toBe(false);
    expect(canEmit('APROVADO', [{ status: 'AUTORIZADA' }] as Pick<FiscalInvoice, 'status'>[]).ok).toBe(false);
  });

  it('permite reemissão quando a última tentativa terminou em ERRO', () => {
    expect(canEmit('APROVADO', [{ status: 'ERRO' }] as Pick<FiscalInvoice, 'status'>[]).ok).toBe(true);
  });

  it('permite reemissão quando a última tentativa foi CANCELADA', () => {
    expect(canEmit('APROVADO', [{ status: 'CANCELADA' }] as Pick<FiscalInvoice, 'status'>[]).ok).toBe(true);
  });
});

describe('canCancel', () => {
  it('rejeita nota não autorizada', () => {
    expect(canCancel({ status: 'PENDENTE' }, 'Justificativa com tamanho suficiente').ok).toBe(false);
    expect(canCancel({ status: 'ERRO' }, 'Justificativa com tamanho suficiente').ok).toBe(false);
  });

  it('rejeita justificativa curta demais (< 15 caracteres)', () => {
    expect(canCancel({ status: 'AUTORIZADA' }, 'curta').ok).toBe(false);
  });

  it('rejeita justificativa longa demais (> 255 caracteres)', () => {
    expect(canCancel({ status: 'AUTORIZADA' }, 'x'.repeat(256)).ok).toBe(false);
  });

  it('aceita nota autorizada com justificativa válida', () => {
    expect(canCancel({ status: 'AUTORIZADA' }, 'Cancelamento solicitado pelo cliente antes do envio').ok).toBe(true);
  });
});

describe('buildFocusRef', () => {
  it('gera referência determinística e sem caracteres especiais', () => {
    const ref = buildFocusRef('tenant-1', 'order-1', 1);
    expect(ref).toBe('tenant1-order1-1');
  });

  it('tentativas diferentes geram referências diferentes', () => {
    expect(buildFocusRef('tenant-1', 'order-1', 1)).not.toBe(buildFocusRef('tenant-1', 'order-1', 2));
  });
});
