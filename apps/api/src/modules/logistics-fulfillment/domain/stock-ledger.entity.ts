// Ledger append-only — nunca é editado, só inserido. O saldo de um SKU num
// depósito é sempre a soma de quantityDelta; nunca uma coluna mutável
// separada (evitaria que a auditoria e o saldo pudessem dessincronizar).
export interface StockLedgerEntry {
  id: string;
  tenantId: string;
  warehouseId: string;
  skuCode: string;
  quantityDelta: number; // negativo = saída/débito, positivo = entrada/crédito
  auditEventId: string; // NOT NULL — ver comentário de regra de ouro em stock-movement-audit-event.entity.ts
  createdAt: Date;
}

// Função pura — soma de quantityDelta. Extraída para ser testável sem
// banco e reaproveitável tanto pelo repositório (que pode preferir uma
// query SQL SUM por performance) quanto por qualquer teste/simulação.
export function computeBalance(entries: Pick<StockLedgerEntry, 'quantityDelta'>[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantityDelta, 0);
}
