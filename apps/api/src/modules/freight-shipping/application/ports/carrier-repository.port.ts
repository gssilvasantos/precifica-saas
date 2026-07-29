// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026, ver docs/carrier-catalog-architecture.md) — cadastro
// próprio no schema freight_shipping, mesmo padrão de
// FreightProviderConnectionRepository (CRUD simples por tenant).
export interface CarrierRecord {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CarrierCreateData = Omit<CarrierRecord, 'id' | 'createdAt' | 'updatedAt'>;

export type CarrierUpdateData = Partial<Omit<CarrierRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>;

export interface CarrierRepository {
  create(data: CarrierCreateData): Promise<CarrierRecord>;
  findById(tenantId: string, id: string): Promise<CarrierRecord | null>;
  findByName(tenantId: string, name: string): Promise<CarrierRecord | null>;
  findAllByTenant(tenantId: string): Promise<CarrierRecord[]>;
  update(id: string, data: CarrierUpdateData): Promise<CarrierRecord>;
}

export const CARRIER_REPOSITORY = Symbol('CARRIER_REPOSITORY');
