export interface OlistConnectionRecord {
  tenantId: string;
  apiTokenEnc: string; // sempre criptografado nesta camada — decrypt só acontece no OlistConnectionService
  isActive: boolean;
  lastSyncedAt: Date | null;
}

export interface OlistConnectionRepository {
  findByTenant(tenantId: string): Promise<OlistConnectionRecord | null>;
  findAllActive(): Promise<OlistConnectionRecord[]>;
  upsert(tenantId: string, apiTokenEnc: string): Promise<OlistConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
  markSynced(tenantId: string, syncedAt: Date): Promise<void>;
}

export const OLIST_CONNECTION_REPOSITORY = Symbol('OLIST_CONNECTION_REPOSITORY');
