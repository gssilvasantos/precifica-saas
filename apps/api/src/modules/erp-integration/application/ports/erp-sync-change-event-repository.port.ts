export type ErpSyncAction = 'CREATED' | 'UPDATED' | 'UNCHANGED';

export interface ErpSyncChangeEvent {
  id: string;
  tenantId: string;
  externalId: string;
  skuCode: string;
  changeSummary: string;
  action: ErpSyncAction;
  contentHash: string;
  syncedAt: Date;
}

export interface ErpSyncChangeEventUpsertData {
  tenantId: string;
  externalId: string;
  skuCode: string;
  changeSummary: string;
  action: ErpSyncAction;
  contentHash: string;
}

export interface ErpSyncChangeEventRepository {
  // Uma linha por (tenantId, externalId) — diferente do MarketplaceChangeEvent
  // (log append-only), este é o "último estado conhecido" do produto,
  // porque é o que o pipeline precisa para decidir "mudou ou não" (seção 6
  // do doc de arquitetura). Histórico completo fica para uma iteração
  // futura, se a auditoria exigir mais que o último snapshot.
  upsert(data: ErpSyncChangeEventUpsertData): Promise<void>;
  findByExternalId(tenantId: string, externalId: string): Promise<ErpSyncChangeEvent | null>;
  findRecent(tenantId: string, limit?: number): Promise<ErpSyncChangeEvent[]>;
}

export const ERP_SYNC_CHANGE_EVENT_REPOSITORY = Symbol('ERP_SYNC_CHANGE_EVENT_REPOSITORY');
