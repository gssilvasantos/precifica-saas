import {
  StockMovementAuditEventItem,
  StockMovementAuditEventItemCreateData,
} from '../../domain/stock-movement-audit-event.entity';

// Sprint 27 (Pick & Pack) — porta do checklist de bipagem. createMany é
// chamado UMA VEZ (na criação do evento, nunca depois); incrementScanned é
// o único jeito de mexer em scannedQuantity — nunca um update genérico que
// aceitaria um valor arbitrário vindo do chamador.
export interface StockMovementAuditEventItemRepository {
  createMany(items: StockMovementAuditEventItemCreateData[]): Promise<StockMovementAuditEventItem[]>;
  findByAuditEvent(tenantId: string, auditEventId: string): Promise<StockMovementAuditEventItem[]>;
  findOneBySku(tenantId: string, auditEventId: string, skuCode: string): Promise<StockMovementAuditEventItem | null>;
  // Incremento atômico de +1 — nunca um SET absoluto vindo do chamador
  // (evita que uma race condition entre duas bipagens simultâneas perca uma
  // contagem; a implementação Prisma usa `increment` do banco).
  incrementScanned(id: string): Promise<StockMovementAuditEventItem>;
}

export const STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY = Symbol('STOCK_MOVEMENT_AUDIT_EVENT_ITEM_REPOSITORY');
