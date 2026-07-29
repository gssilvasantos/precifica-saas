import { Vendedor, VendedorCreateData, VendedorUpdateData } from '../../domain/vendedor.entity';

export interface VendedorRepository {
  create(data: VendedorCreateData): Promise<Vendedor>;
  findById(tenantId: string, id: string): Promise<Vendedor | null>;
  findAllByTenant(tenantId: string): Promise<Vendedor[]>;
  update(id: string, data: VendedorUpdateData): Promise<Vendedor>;
  setActive(id: string, isActive: boolean): Promise<Vendedor>;
}

export const VENDEDOR_REPOSITORY = Symbol('VENDEDOR_REPOSITORY');
