export interface NuvemshopConnectionRecord {
  tenantId: string;
  storeId: string;
  accessTokenEnc: string;
  isActive: boolean;
  lastSyncedAt: Date | null;
}

export interface NuvemshopConnectionRepository {
  findByTenant(tenantId: string): Promise<NuvemshopConnectionRecord | null>;
  findAllActive(): Promise<NuvemshopConnectionRecord[]>;
  upsert(tenantId: string, storeId: string, accessTokenEnc: string): Promise<NuvemshopConnectionRecord>;
  deactivate(tenantId: string): Promise<void>;
  markSynced(tenantId: string, syncedAt: Date): Promise<void>;
}

export const NUVEMSHOP_CONNECTION_REPOSITORY = Symbol('NUVEMSHOP_CONNECTION_REPOSITORY');
