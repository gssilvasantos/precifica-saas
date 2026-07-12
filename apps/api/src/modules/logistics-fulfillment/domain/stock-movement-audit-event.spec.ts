import {
  canApprove,
  canMarkDivergent,
  buildLedgerEntries,
  buildChecklistFromOrderItems,
  isFullyScanned,
  canScanItem,
  StockMovementAuditEvent,
  StockMovementAuditEventItem,
} from './stock-movement-audit-event.entity';

function buildItem(overrides: Partial<StockMovementAuditEventItem> = {}): StockMovementAuditEventItem {
  return {
    id: 'item-1',
    tenantId: 'tenant-1',
    auditEventId: 'event-1',
    skuCode: 'SKU-1',
    expectedQuantity: 2,
    scannedQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildEvent(overrides: Partial<StockMovementAuditEvent> = {}): StockMovementAuditEvent {
  return {
    id: 'event-1',
    tenantId: 'tenant-1',
    eventType: 'RETAIL_SHIPMENT',
    sourceWarehouseId: 'wh-physical',
    destinationWarehouseId: null,
    mediaUrl: null,
    mediaType: null,
    conferenceStatus: 'PENDENTE',
    conferredByUserId: null,
    conferredAt: null,
    divergenceNotes: null,
    invoiceNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    orderIds: ['order-1'],
    ...overrides,
  };
}

describe('canApprove — regra de ouro: sem mídia aprovada, sem movimento de estoque', () => {
  it('recusa aprovar sem mídia anexada', () => {
    const result = canApprove(buildEvent({ mediaUrl: null }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verificação visual é obrigatória/i);
  });

  it('permite aprovar quando PENDENTE com mídia anexada', () => {
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.jpg' }));
    expect(result.ok).toBe(true);
  });

  it('recusa aprovar um evento que já está APROVADO (não aprova duas vezes)', () => {
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.jpg', conferenceStatus: 'APROVADO' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/já está APROVADO/i);
  });

  it('recusa aprovar um evento que já está DIVERGENTE', () => {
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.jpg', conferenceStatus: 'DIVERGENTE' }));
    expect(result.ok).toBe(false);
  });

  // Sprint 27 — o "juiz": Finalizar Embalagem bloqueado até 100% bipado.
  it('recusa aprovar com mídia OK mas checklist incompleto (SKU faltando bipar)', () => {
    const items = [buildItem({ expectedQuantity: 2, scannedQuantity: 1 })];
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.mp4' }), items);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/checklist/i);
  });

  it('permite aprovar com mídia OK e checklist 100% bipado', () => {
    const items = [buildItem({ expectedQuantity: 2, scannedQuantity: 2 }), buildItem({ skuCode: 'SKU-2', expectedQuantity: 1, scannedQuantity: 1 })];
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.mp4' }), items);
    expect(result.ok).toBe(true);
  });

  it('checklist vazio (reabastecimento preventivo, sem pedido nenhum atrás) continua aprovável só com mídia — comportamento legado da Sprint 24', () => {
    const result = canApprove(buildEvent({ mediaUrl: 'https://storage/prova.jpg', orderIds: [] }), []);
    expect(result.ok).toBe(true);
  });
});

describe('buildChecklistFromOrderItems', () => {
  it('agrega o mesmo SKU vindo de pedidos diferentes numa única linha', () => {
    const checklist = buildChecklistFromOrderItems([
      { skuCode: 'SKU-1', quantity: 2 },
      { skuCode: 'SKU-1', quantity: 3 },
      { skuCode: 'SKU-2', quantity: 1 },
    ]);

    expect(checklist).toEqual(
      expect.arrayContaining([
        { skuCode: 'SKU-1', expectedQuantity: 5 },
        { skuCode: 'SKU-2', expectedQuantity: 1 },
      ]),
    );
    expect(checklist).toHaveLength(2);
  });

  it('exclui itens sem skuCode resolvido (não há código de barras interno para bipar)', () => {
    const checklist = buildChecklistFromOrderItems([
      { skuCode: null, quantity: 1 },
      { skuCode: 'SKU-1', quantity: 1 },
    ]);

    expect(checklist).toEqual([{ skuCode: 'SKU-1', expectedQuantity: 1 }]);
  });
});

describe('isFullyScanned', () => {
  it('aprova vacuamente uma lista vazia (fluxo legado sem checklist)', () => {
    expect(isFullyScanned([]).ok).toBe(true);
  });

  it('reprova quando qualquer SKU ainda não atingiu a quantidade esperada', () => {
    const result = isFullyScanned([buildItem({ expectedQuantity: 3, scannedQuantity: 2 })]);
    expect(result.ok).toBe(false);
  });

  it('aprova quando todo SKU atingiu exatamente a quantidade esperada', () => {
    const result = isFullyScanned([
      buildItem({ skuCode: 'SKU-1', expectedQuantity: 3, scannedQuantity: 3 }),
      buildItem({ skuCode: 'SKU-2', expectedQuantity: 1, scannedQuantity: 1 }),
    ]);
    expect(result.ok).toBe(true);
  });
});

describe('canScanItem', () => {
  it('recusa bipar um SKU que não está no checklist deste evento', () => {
    const result = canScanItem(undefined, 'SKU-FORA');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/não está no checklist/i);
  });

  it('recusa bipar além da quantidade esperada (bipagem extra)', () => {
    const result = canScanItem(buildItem({ expectedQuantity: 2, scannedQuantity: 2 }), 'SKU-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bipagem extra/i);
  });

  it('permite bipar quando ainda não atingiu a quantidade esperada', () => {
    const result = canScanItem(buildItem({ expectedQuantity: 2, scannedQuantity: 1 }), 'SKU-1');
    expect(result.ok).toBe(true);
  });
});

describe('canMarkDivergent', () => {
  it('permite marcar divergente um evento PENDENTE, mesmo sem mídia', () => {
    // Divergência pode ser constatada mesmo antes/sem mídia (ex.: item
    // fisicamente ausente na conferência) — não tem o mesmo requisito de
    // mídia que a aprovação.
    const result = canMarkDivergent(buildEvent({ mediaUrl: null }));
    expect(result.ok).toBe(true);
  });

  it('recusa marcar divergente um evento que já foi decidido antes', () => {
    const result = canMarkDivergent(buildEvent({ conferenceStatus: 'APROVADO' }));
    expect(result.ok).toBe(false);
  });
});

describe('buildLedgerEntries', () => {
  it('RETAIL_SHIPMENT (sem destino): gera só o débito do físico', () => {
    const event = buildEvent({ destinationWarehouseId: null });
    const entries = buildLedgerEntries(event, [{ skuCode: 'SKU-1', quantity: 3 }]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ warehouseId: 'wh-physical', skuCode: 'SKU-1', quantityDelta: -3, auditEventId: 'event-1' });
  });

  it('FULL_DISPATCH (com destino): gera débito do físico E crédito simétrico no CD virtual, mesmo auditEventId', () => {
    const event = buildEvent({ eventType: 'FULL_DISPATCH', destinationWarehouseId: 'wh-cd-full-ml' });
    const entries = buildLedgerEntries(event, [{ skuCode: 'SKU-1', quantity: 5 }]);

    expect(entries).toHaveLength(2);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ warehouseId: 'wh-physical', skuCode: 'SKU-1', quantityDelta: -5, auditEventId: 'event-1' }),
        expect.objectContaining({ warehouseId: 'wh-cd-full-ml', skuCode: 'SKU-1', quantityDelta: 5, auditEventId: 'event-1' }),
      ]),
    );
  });

  it('múltiplos SKUs no mesmo lote: uma linha (ou duas, se Full) por SKU', () => {
    const event = buildEvent({ eventType: 'FULL_DISPATCH', destinationWarehouseId: 'wh-cd-full-ml' });
    const entries = buildLedgerEntries(event, [
      { skuCode: 'SKU-1', quantity: 2 },
      { skuCode: 'SKU-2', quantity: 1 },
    ]);

    expect(entries).toHaveLength(4);
  });

  it('quantidade é sempre absoluta na entrada — a direção do delta é decidida aqui, nunca pelo chamador', () => {
    const event = buildEvent({ destinationWarehouseId: null });
    const entries = buildLedgerEntries(event, [{ skuCode: 'SKU-1', quantity: -7 }]);

    expect(entries[0].quantityDelta).toBe(-7);
  });
});
