import { Supplier } from '../../domain/supplier.entity';

export interface SupplierCreateData {
  tenantId: string;
  name: string;
  contact?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
}

export type SupplierUpdateData = Partial<Omit<SupplierCreateData, 'tenantId'>>;

export interface SupplierRepository {
  create(data: SupplierCreateData): Promise<Supplier>;
  findAllActive(tenantId: string): Promise<Supplier[]>;
  findById(tenantId: string, id: string): Promise<Supplier | null>;
  update(id: string, data: SupplierUpdateData): Promise<Supplier>;
  deactivate(id: string): Promise<Supplier>;
}

export const SUPPLIER_REPOSITORY = Symbol('SUPPLIER_REPOSITORY');
