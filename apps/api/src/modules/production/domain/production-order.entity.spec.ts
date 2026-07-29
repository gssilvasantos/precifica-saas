import { canCancel, canConclude, canStart, isValidQuantity, ProductionOrder } from './production-order.entity';

function buildOrder(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    id: 'po-1',
    tenantId: 'tenant-1',
    status: 'RASCUNHO',
    parentSkuCode: 'KIT-1',
    quantity: 10,
    sourceWarehouseId: 'wh-physical',
    destinationWarehouseId: 'wh-physical',
    notes: null,
    concludedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    components: [],
    ...overrides,
  };
}

describe('isValidQuantity', () => {
  it('aceita inteiro positivo', () => {
    expect(isValidQuantity(5)).toBe(true);
  });

  it('rejeita zero, negativo e fracionário', () => {
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(-1)).toBe(false);
    expect(isValidQuantity(1.5)).toBe(false);
  });
});

describe('canStart', () => {
  it('permite a partir de RASCUNHO', () => {
    expect(canStart(buildOrder({ status: 'RASCUNHO' })).ok).toBe(true);
  });

  it('recusa a partir de qualquer outro estado', () => {
    expect(canStart(buildOrder({ status: 'EM_ANDAMENTO' })).ok).toBe(false);
    expect(canStart(buildOrder({ status: 'CONCLUIDA' })).ok).toBe(false);
    expect(canStart(buildOrder({ status: 'CANCELADA' })).ok).toBe(false);
  });
});

describe('canConclude', () => {
  it('permite a partir de RASCUNHO ou EM_ANDAMENTO', () => {
    expect(canConclude(buildOrder({ status: 'RASCUNHO' })).ok).toBe(true);
    expect(canConclude(buildOrder({ status: 'EM_ANDAMENTO' })).ok).toBe(true);
  });

  it('recusa se já concluída ou cancelada', () => {
    expect(canConclude(buildOrder({ status: 'CONCLUIDA' })).ok).toBe(false);
    expect(canConclude(buildOrder({ status: 'CANCELADA' })).ok).toBe(false);
  });
});

describe('canCancel', () => {
  it('permite a partir de RASCUNHO ou EM_ANDAMENTO', () => {
    expect(canCancel(buildOrder({ status: 'RASCUNHO' })).ok).toBe(true);
    expect(canCancel(buildOrder({ status: 'EM_ANDAMENTO' })).ok).toBe(true);
  });

  it('nunca cancela a partir de CONCLUIDA — estoque já foi movido', () => {
    expect(canCancel(buildOrder({ status: 'CONCLUIDA' })).ok).toBe(false);
  });

  it('é idempotente a partir de CANCELADA', () => {
    expect(canCancel(buildOrder({ status: 'CANCELADA' })).ok).toBe(true);
  });
});
