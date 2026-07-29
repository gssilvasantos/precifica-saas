import {
  canApprove,
  canMarkDivergent,
  buildLedgerEntries,
  buildChecklistFromOrderItems,
  isFullyScanned,
  canScanItem,
  canApprovePurchaseReceipt,
  buildPurchaseReceiptLedgerEntries,
  canApproveProduction,
  buildProductionLedgerEntries,
  canApproveLotAdjustment,
  resolveLotAdjustmentDelta,
  buildLotAdjustmentLedgerEntry,
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
    notes: null,
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

describe('canApprovePurchaseReceipt — Ordem de Compra (Fase 1): prova é a NF, não mídia', () => {
  it('aprova quando PENDENTE e invoiceNumber preenchido', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT', mediaUrl: null, invoiceNumber: 'NF-123' });
    expect(canApprovePurchaseReceipt(event).ok).toBe(true);
  });

  it('recusa sem invoiceNumber, mesmo sem exigir mídia', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT', mediaUrl: null, invoiceNumber: null });
    const result = canApprovePurchaseReceipt(event);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/nota fiscal/i);
  });

  it('recusa evento que já não está PENDENTE', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT', conferenceStatus: 'APROVADO', invoiceNumber: 'NF-123' });
    expect(canApprovePurchaseReceipt(event).ok).toBe(false);
  });
});

describe('buildPurchaseReceiptLedgerEntries', () => {
  it('gera só CRÉDITO (positivo) no depósito, nunca débito', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT', sourceWarehouseId: 'wh-physical' });
    const entries = buildPurchaseReceiptLedgerEntries(event, [{ skuCode: 'SKU-1', quantity: 10 }]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ warehouseId: 'wh-physical', skuCode: 'SKU-1', quantityDelta: 10, auditEventId: 'event-1' });
  });

  it('quantidade sempre absoluta, mesmo se vier negativa por engano', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT' });
    const entries = buildPurchaseReceiptLedgerEntries(event, [{ skuCode: 'SKU-1', quantity: -5 }]);
    expect(entries[0].quantityDelta).toBe(5);
  });

  it('uma linha por SKU, sem segundo depósito envolvido', () => {
    const event = buildEvent({ eventType: 'PURCHASE_RECEIPT' });
    const entries = buildPurchaseReceiptLedgerEntries(event, [
      { skuCode: 'SKU-1', quantity: 2 },
      { skuCode: 'SKU-2', quantity: 3 },
    ]);
    expect(entries).toHaveLength(2);
  });
});

// Ordem de Produção (Projeto Estruturante 1, benchmark Bling ERP, 29/07/2026)
describe('canApproveProduction — prova é a própria ordem de produção confirmada, não mídia nem NF', () => {
  it('aprova sem mídia e sem invoiceNumber, bastando PENDENTE', () => {
    const event = buildEvent({ eventType: 'PRODUCTION_OUTPUT', mediaUrl: null, invoiceNumber: null });
    expect(canApproveProduction(event).ok).toBe(true);
  });

  it('recusa evento que já não está PENDENTE', () => {
    const event = buildEvent({ eventType: 'PRODUCTION_OUTPUT', conferenceStatus: 'APROVADO' });
    expect(canApproveProduction(event).ok).toBe(false);
  });
});

describe('buildProductionLedgerEntries', () => {
  it('gera débito (negativo) de cada componente na origem + crédito (positivo) do produto acabado no destino', () => {
    const event = buildEvent({
      eventType: 'PRODUCTION_OUTPUT',
      sourceWarehouseId: 'wh-physical',
      destinationWarehouseId: 'wh-physical',
    }) as StockMovementAuditEvent & { destinationWarehouseId: string };

    const entries = buildProductionLedgerEntries(
      event,
      [
        { skuCode: 'COMPONENTE-1', quantity: 4 },
        { skuCode: 'COMPONENTE-2', quantity: 2 },
      ],
      { skuCode: 'KIT-1', quantity: 2 },
    );

    expect(entries).toHaveLength(3);
    expect(entries).toEqual(
      expect.arrayContaining([
        { tenantId: 'tenant-1', warehouseId: 'wh-physical', skuCode: 'COMPONENTE-1', quantityDelta: -4, auditEventId: 'event-1' },
        { tenantId: 'tenant-1', warehouseId: 'wh-physical', skuCode: 'COMPONENTE-2', quantityDelta: -2, auditEventId: 'event-1' },
        { tenantId: 'tenant-1', warehouseId: 'wh-physical', skuCode: 'KIT-1', quantityDelta: 2, auditEventId: 'event-1' },
      ]),
    );
  });

  it('quantidade sempre absoluta, mesmo se vier negativa por engano', () => {
    const event = buildEvent({
      eventType: 'PRODUCTION_OUTPUT',
      sourceWarehouseId: 'wh-a',
      destinationWarehouseId: 'wh-b',
    }) as StockMovementAuditEvent & { destinationWarehouseId: string };

    const entries = buildProductionLedgerEntries(event, [{ skuCode: 'COMP-1', quantity: -3 }], { skuCode: 'KIT-1', quantity: -1 });

    expect(entries.find((e) => e.skuCode === 'COMP-1')?.quantityDelta).toBe(-3);
    expect(entries.find((e) => e.skuCode === 'KIT-1')?.quantityDelta).toBe(1);
  });

  it('debita na origem, credita no destino — depósitos diferentes', () => {
    const event = buildEvent({
      eventType: 'PRODUCTION_OUTPUT',
      sourceWarehouseId: 'wh-origem',
      destinationWarehouseId: 'wh-destino',
    }) as StockMovementAuditEvent & { destinationWarehouseId: string };

    const entries = buildProductionLedgerEntries(event, [{ skuCode: 'COMP-1', quantity: 1 }], { skuCode: 'KIT-1', quantity: 1 });

    expect(entries.find((e) => e.skuCode === 'COMP-1')?.warehouseId).toBe('wh-origem');
    expect(entries.find((e) => e.skuCode === 'KIT-1')?.warehouseId).toBe('wh-destino');
  });
});

describe('canApproveLotAdjustment (Produtos-Lotes, Projeto Estruturante 2)', () => {
  it('recusa aprovar sem justificativa (notes)', () => {
    const result = canApproveLotAdjustment(buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: null }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/justificativa/i);
  });

  it('recusa notes só com espaços em branco', () => {
    const result = canApproveLotAdjustment(buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: '   ' }));
    expect(result.ok).toBe(false);
  });

  it('permite aprovar com justificativa preenchida', () => {
    const result = canApproveLotAdjustment(
      buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: 'Correção de contagem física do lote L1.' }),
    );
    expect(result.ok).toBe(true);
  });

  it('recusa aprovar um evento que já está APROVADO', () => {
    const result = canApproveLotAdjustment(
      buildEvent({ eventType: 'LOT_ADJUSTMENT', notes: 'ok', conferenceStatus: 'APROVADO' }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/já está APROVADO/i);
  });
});

describe('resolveLotAdjustmentDelta', () => {
  it('ENTRADA sempre positiva, mesmo se quantity vier negativa por engano', () => {
    expect(resolveLotAdjustmentDelta({ movementType: 'ENTRADA', quantity: 5 }, 0)).toBe(5);
    expect(resolveLotAdjustmentDelta({ movementType: 'ENTRADA', quantity: -5 }, 0)).toBe(5);
  });

  it('SAIDA sempre negativa, mesmo se quantity vier negativa por engano', () => {
    expect(resolveLotAdjustmentDelta({ movementType: 'SAIDA', quantity: 5 }, 0)).toBe(-5);
    expect(resolveLotAdjustmentDelta({ movementType: 'SAIDA', quantity: -5 }, 0)).toBe(-5);
  });

  it('BALANCO calcula o delta contra o saldo atual, não é a quantidade em si', () => {
    expect(resolveLotAdjustmentDelta({ movementType: 'BALANCO', quantity: 30 }, 25)).toBe(5);
    expect(resolveLotAdjustmentDelta({ movementType: 'BALANCO', quantity: 10 }, 25)).toBe(-15);
    expect(resolveLotAdjustmentDelta({ movementType: 'BALANCO', quantity: 25 }, 25)).toBe(0);
  });
});

describe('buildLotAdjustmentLedgerEntry', () => {
  it('gera exatamente uma linha, carregando lotCode', () => {
    const event = buildEvent({ eventType: 'LOT_ADJUSTMENT', sourceWarehouseId: 'wh-physical' });

    const entry = buildLotAdjustmentLedgerEntry(event, { skuCode: 'SKU-1', lotCode: 'L1', quantityDelta: -3 });

    expect(entry).toEqual({
      tenantId: 'tenant-1',
      warehouseId: 'wh-physical',
      skuCode: 'SKU-1',
      quantityDelta: -3,
      auditEventId: 'event-1',
      lotCode: 'L1',
    });
  });
});
