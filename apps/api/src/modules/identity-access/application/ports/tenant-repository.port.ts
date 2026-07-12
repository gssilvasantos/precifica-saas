import { Tenant } from '../../domain/tenant.entity';

export interface TenantRepository {
  create(data: { name: string; document?: string }): Promise<Tenant>;
  findById(id: string): Promise<Tenant | null>;
}

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');
