export type ReceivableStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface ReceivableRecord {
  id: string;
  tenantId: string;
  amount: number;
  status: ReceivableStatus;
  expectedDate: Date;
  paidAt: Date | null;
  marketplaceSource: string;
  externalReference: string | null;
  skuCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceivableRecordCreateData {
  tenantId: string;
  amount: number;
  expectedDate: Date;
  marketplaceSource: string;
  externalReference?: string;
  skuCode?: string;
  status?: ReceivableStatus;
}

// Reconciliação (ver ReceivableReconciliationService) só precisa mudar
// status/paidAt — nunca reabre o resto do registro.
export interface ReceivableMarkPaidData {
  status: 'PAID';
  paidAt: Date;
}
