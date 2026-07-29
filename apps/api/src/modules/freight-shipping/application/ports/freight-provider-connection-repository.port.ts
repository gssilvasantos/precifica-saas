export interface FreightProviderConnectionRecord {
  id: string;
  tenantId: string;
  providerCode: string;
  credentialEnc: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FreightProviderConnectionUpsertData {
  tenantId: string;
  providerCode: string;
  credentialEnc: string;
  isActive?: boolean;
}

export interface FreightProviderConnectionRepository {
  upsert(data: FreightProviderConnectionUpsertData): Promise<FreightProviderConnectionRecord>;
  findByTenantAndProvider(tenantId: string, providerCode: string): Promise<FreightProviderConnectionRecord | null>;
  findAllByTenant(tenantId: string): Promise<FreightProviderConnectionRecord[]>;
  remove(tenantId: string, providerCode: string): Promise<void>;
}

export const FREIGHT_PROVIDER_CONNECTION_REPOSITORY = Symbol('FREIGHT_PROVIDER_CONNECTION_REPOSITORY');
