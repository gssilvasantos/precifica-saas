import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  SupplierCreateData,
  SupplierRepository,
  SupplierUpdateData,
} from '../application/ports/supplier-repository.port';

@Injectable()
export class PrismaSupplierRepository implements SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: SupplierCreateData) {
    return this.prisma.supplier.create({ data });
  }

  findAllActive(tenantId: string) {
    return this.prisma.supplier.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
  }

  findById(tenantId: string, id: string) {
    return this.prisma.supplier.findFirst({ where: { id, tenantId } });
  }

  update(id: string, data: SupplierUpdateData) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  deactivate(id: string) {
    return this.prisma.supplier.update({ where: { id }, data: { isActive: false } });
  }
}
