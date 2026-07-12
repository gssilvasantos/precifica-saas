import {
  ReceivableMarkPaidData,
  ReceivableRecord,
  ReceivableRecordCreateData,
  ReceivableStatus,
} from '../../domain/receivable-record.entity';

export interface ReceivableRecordRepository {
  create(data: ReceivableRecordCreateData): Promise<ReceivableRecord>;
  findById(tenantId: string, id: string): Promise<ReceivableRecord | null>;
  findByStatus(tenantId: string, status: ReceivableStatus): Promise<ReceivableRecord[]>;
  // Usado pela reconciliação (ver ReceivableReconciliationService) — a
  // chave de match é (tenant, canal, referência externa), nunca o id
  // interno (que o marketplace não conhece).
  findByExternalReference(
    tenantId: string,
    marketplaceSource: string,
    externalReference: string,
  ): Promise<ReceivableRecord | null>;
  markPaid(id: string, data: ReceivableMarkPaidData): Promise<ReceivableRecord>;
  // Consumido pelo ReceivableFromOrderListener (Orders -> Financial
  // Intelligence) quando um pedido JÁ PAGO é cancelado depois — nunca
  // apaga a linha (auditoria), só muda o status. Ver domain/receivable-record.entity.ts.
  cancel(id: string): Promise<ReceivableRecord>;
}

export const RECEIVABLE_RECORD_REPOSITORY = Symbol('RECEIVABLE_RECORD_REPOSITORY');
