import { StockMovementAuditEvent, StockMovementAuditEventCreateData } from '../../domain/stock-movement-audit-event.entity';

export interface LedgerEntryInput {
  tenantId: string;
  warehouseId: string;
  skuCode: string;
  quantityDelta: number;
  auditEventId: string;
}

export interface StockMovementAuditEventRepository {
  create(data: StockMovementAuditEventCreateData): Promise<StockMovementAuditEvent>;
  findById(tenantId: string, id: string): Promise<StockMovementAuditEvent | null>;
  // Idempotência do listener de ORDER_EVENTS.READY_FOR_FULFILLMENT — um
  // pedido nunca deve gerar dois eventos RETAIL_SHIPMENT (ex.: reimportado
  // pelo sync antes de mudar de status de novo). Mesmo racional de
  // ReceivableFromOrderListener checando existência antes de criar.
  findByOrderId(tenantId: string, orderId: string, eventType: StockMovementAuditEvent['eventType']): Promise<StockMovementAuditEvent | null>;
  attachMedia(id: string, mediaUrl: string, mediaType: string): Promise<StockMovementAuditEvent>;
  // Grava o novo status (APROVADO) E as linhas de ledger na MESMA
  // transação — nunca em dois passos separados, para que não exista uma
  // janela onde o evento já esteja aprovado mas o estoque ainda não tenha
  // se movido (ou vice-versa). As linhas já vêm calculadas pelo domain
  // (buildLedgerEntries) — este método só persiste.
  approveWithLedger(id: string, conferredByUserId: string, ledgerEntries: LedgerEntryInput[]): Promise<StockMovementAuditEvent>;
  markDivergent(id: string, conferredByUserId: string, divergenceNotes: string): Promise<StockMovementAuditEvent>;
  // Sprint 27 (Pick & Pack) — fila de trabalho do operador de expedição: os
  // eventos ainda PENDENTES, mais antigos primeiro (FIFO — quem chegou
  // primeiro na doca é conferido primeiro). Sem isso a tela de conferência
  // não teria como descobrir QUAL evento abrir sem já saber o ID de antemão.
  findPending(tenantId: string): Promise<StockMovementAuditEvent[]>;
}

export const STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY = Symbol('STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY');
