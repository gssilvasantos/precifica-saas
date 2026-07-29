// Exportado pelo Logistics Fulfillment (StockMovementAuditEventService),
// consumido pelo Procurement (Ordem de Compra, Fase 1) ao confirmar
// recebimento — DTO autocontido, mesma disciplina de OrderFinancialsReader/
// OrderFinancialLine: nenhum tipo do domínio interno de logistics-fulfillment
// vaza para cá.
export interface StockReceiptLine {
  skuCode: string;
  quantity: number;
}

export interface StockReceiptWriter {
  // Dá entrada de mercadoria comprada num depósito — cria E aprova o evento
  // de auditoria (Hub de Provas) atomicamente, tipo PURCHASE_RECEIPT, usando
  // o número da NF como prova (em vez de mídia/vídeo, que é o padrão de
  // SAÍDA). Ver logistics-fulfillment/domain/stock-movement-audit-event.entity.ts,
  // canApprovePurchaseReceipt/buildPurchaseReceiptLedgerEntries.
  receivePurchase(
    tenantId: string,
    warehouseId: string,
    invoiceNumber: string,
    conferredByUserId: string,
    lines: StockReceiptLine[],
  ): Promise<{ auditEventId: string }>;
}

export const STOCK_RECEIPT_WRITER = Symbol('STOCK_RECEIPT_WRITER');
