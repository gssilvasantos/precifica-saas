import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUPPLIER_REPOSITORY, SupplierRepository, SupplierUpdateData } from './ports/supplier-repository.port';

export interface CreateSupplierInput {
  name: string;
  contact?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
}

@Injectable()
export class SuppliersService {
  constructor(@Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository) {}

  create(tenantId: string, input: CreateSupplierInput) {
    return this.suppliers.create({ tenantId, ...input });
  }

  findAll(tenantId: string) {
    return this.suppliers.findAllActive(tenantId);
  }

  async findOne(tenantId: string, id: string) {
    const supplier = await this.suppliers.findById(tenantId, id);
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado.');
    return supplier;
  }

  async update(tenantId: string, id: string, input: SupplierUpdateData) {
    await this.findOne(tenantId, id);
    return this.suppliers.update(id, input);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.suppliers.deactivate(id);
  }
}
