import {
  PurchaseOrder,
  PurchaseOrderItem,
  canAdvance,
  canCancel,
  canReceive,
  computeTotalAmount,
  isValidItems,
} from './purchase-order.entity';

function buildOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    tenantId: 'tenant-1',
    status: 'ABERTO',
    supplierId: 'supplier-1',
    warehouseId: 'warehouse-1',
    paymentDueDate: new Date('2026-08-15'),
    notes: null,
    invoiceNumber: null,
    receivedAt: null,
    createdAt: new Date('2026-07-28'),
    updatedAt: new Date('2026-07-28'),
    items: [],
    ...overrides,
  };
}

function buildItem(overrides: Partial<PurchaseOrderItem> = {}): PurchaseOrderItem {
  return {
    id: 'item-1',
    tenantId: 'tenant-1',
    purchaseOrderId: 'po-1',
    skuCode: 'SKU-1',
    quantity: 10,
    unitCost: 5,
    ipi: null,
    createdAt: new Date('2026-07-28'),
    updatedAt: new Date('2026-07-28'),
    ...overrides,
  };
}

describe('isValidItems', () => {
  it('rejeita lista vazia', () => {
    expect(isValidItems([])).toBe(false);
  });

  it('rejeita item com skuCode vazio', () => {
    expect(isValidItems([{ skuCode: '  ', quantity: 1, unitCost: 1 }])).toBe(false);
  });

  it('rejeita quantity não inteiro ou não positivo', () => {
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 0, unitCost: 1 }])).toBe(false);
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 1.5, unitCost: 1 }])).toBe(false);
  });

  it('rejeita unitCost negativo', () => {
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 1, unitCost: -1 }])).toBe(false);
  });

  it('rejeita ipi negativo quando informado', () => {
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 1, unitCost: 1, ipi: -1 }])).toBe(false);
  });

  it('aceita lista válida sem ipi', () => {
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 1, unitCost: 1 }])).toBe(true);
  });

  it('aceita lista válida com ipi', () => {
    expect(isValidItems([{ skuCode: 'SKU-1', quantity: 1, unitCost: 1, ipi: 0.5 }])).toBe(true);
  });
});

describe('computeTotalAmount', () => {
  it('soma quantity*unitCost de cada item', () => {
    const items = [buildItem({ quantity: 10, unitCost: 5, ipi: null }), buildItem({ quantity: 2, unitCost: 3, ipi: null })];
    expect(computeTotalAmount(items)).toBe(56); // 10*5 + 2*3
  });

  it('soma o ipi por item quando informado', () => {
    const items = [buildItem({ quantity: 10, unitCost: 5, ipi: 2.5 })];
    expect(computeTotalAmount(items)).toBe(52.5);
  });

  it('trabalha em centavos para evitar drift de ponto flutuante', () => {
    const items = [buildItem({ quantity: 3, unitCost: 0.1, ipi: null })];
    expect(computeTotalAmount(items)).toBe(0.3);
  });

  it('retorna 0 para lista vazia', () => {
    expect(computeTotalAmount([])).toBe(0);
  });
});

describe('canAdvance', () => {
  it('permite avançar a partir de ABERTO', () => {
    expect(canAdvance(buildOrder({ status: 'ABERTO' })).ok).toBe(true);
  });

  it('rejeita a partir de ANDAMENTO', () => {
    const check = canAdvance(buildOrder({ status: 'ANDAMENTO' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/ANDAMENTO/);
  });

  it('rejeita a partir de ATENDIDO', () => {
    expect(canAdvance(buildOrder({ status: 'ATENDIDO' })).ok).toBe(false);
  });

  it('rejeita a partir de CANCELADO', () => {
    expect(canAdvance(buildOrder({ status: 'CANCELADO' })).ok).toBe(false);
  });
});

describe('canReceive', () => {
  it('permite receber a partir de ABERTO', () => {
    expect(canReceive(buildOrder({ status: 'ABERTO' })).ok).toBe(true);
  });

  it('permite receber a partir de ANDAMENTO', () => {
    expect(canReceive(buildOrder({ status: 'ANDAMENTO' })).ok).toBe(true);
  });

  it('rejeita receber de novo a partir de ATENDIDO', () => {
    const check = canReceive(buildOrder({ status: 'ATENDIDO' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/já foi recebida/);
  });

  it('rejeita receber a partir de CANCELADO', () => {
    expect(canReceive(buildOrder({ status: 'CANCELADO' })).ok).toBe(false);
  });
});

describe('canCancel', () => {
  it('permite cancelar a partir de ABERTO', () => {
    expect(canCancel(buildOrder({ status: 'ABERTO' })).ok).toBe(true);
  });

  it('permite cancelar a partir de ANDAMENTO', () => {
    expect(canCancel(buildOrder({ status: 'ANDAMENTO' })).ok).toBe(true);
  });

  it('rejeita cancelar a partir de ATENDIDO', () => {
    const check = canCancel(buildOrder({ status: 'ATENDIDO' }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/ATENDIDO/);
  });

  it('é idempotente a partir de CANCELADO', () => {
    expect(canCancel(buildOrder({ status: 'CANCELADO' })).ok).toBe(true);
  });
});
