// Exportado pelo Logistics Fulfillment (StockMovementAuditEventService),
// consumido pelo módulo production (ProductionOrderService) ao concluir uma
// ordem — DTO autocontido, mesma disciplina de StockReceiptLine/
// OrderFinancialLine: nenhum tipo do domínio interno de logistics-fulfillment
// vaza para cá. Irmã de StockReceiptWriter (Ordem de Compra, Fase 1), mas
// para um evento que debita E credita no MESMO auditEventId (componentes
// saindo, produto acabado entrando), nunca só crédito.
export interface ProductionStockLine {
  skuCode: string;
  quantity: number;
}

export interface ProductionStockWriter {
  // Debita os componentes (uma ou mais linhas) no depósito de origem E
  // credita o produto acabado (uma linha) no depósito de destino — cria E
  // aprova o evento de auditoria (Hub de Provas) atomicamente, tipo
  // PRODUCTION_OUTPUT, usando a própria ProductionOrder já confirmada como
  // prova (nunca mídia/vídeo nem NF). Ver
  // logistics-fulfillment/domain/stock-movement-audit-event.entity.ts,
  // canApproveProduction/buildProductionLedgerEntries.
  produceOutput(
    tenantId: string,
    sourceWarehouseId: string,
    destinationWarehouseId: string,
    conferredByUserId: string,
    componentLines: ProductionStockLine[],
    outputLine: ProductionStockLine,
  ): Promise<{ auditEventId: string }>;
}

export const PRODUCTION_STOCK_WRITER = Symbol('PRODUCTION_STOCK_WRITER');
