export interface OlistConnectionRecord {
  tenantId: string;
  apiTokenEnc: string; // sempre criptografado nesta camada — decrypt só acontece no OlistConnectionService
  isActive: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null; // SUCCESS | FAILED — ver comentário na migração 20260731160000
  lastSyncError: string | null;
}

export interface OlistConnectionRepository {
  findByTenant(tenantId: string): Promise<OlistConnectionRecord | null>;
  findAllActive(): Promise<OlistConnectionRecord[]>;
  upsert(tenantId: string, apiTokenEnc: string): Promise<OlistConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
  markSynced(tenantId: string, syncedAt: Date): Promise<void>;
  // Contraparte de markSynced no caminho de erro — ErpSyncOrchestrator chama
  // uma OU outra ao final de cada tentativa, nunca as duas.
  markSyncFailed(tenantId: string, error: string): Promise<void>;
}

export const OLIST_CONNECTION_REPOSITORY = Symbol('OLIST_CONNECTION_REPOSITORY');
