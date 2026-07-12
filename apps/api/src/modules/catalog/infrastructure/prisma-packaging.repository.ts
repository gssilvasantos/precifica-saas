import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PackagingRepository } from '../application/ports/packaging-repository.port';
import { Packaging, PackagingCreateData, PackagingUpdateData } from '../domain/packaging.entity';

@Injectable()
export class PrismaPackagingRepository implements PackagingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: PackagingCreateData): Promise<Packaging> {
    const record = await this.prisma.packaging.create({ data });
    return this.toDomain(record);
  }

  async findAllActive(tenantId: string): Promise<Packaging[]> {
    const records = await this.prisma.packaging.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  async findById(tenantId: string, id: string): Promise<Packaging | null> {
    const record = await this.prisma.packaging.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async update(id: string, data: PackagingUpdateData): Promise<Packaging> {
    const record = await this.prisma.packaging.update({ where: { id }, data });
    return this.toDomain(record);
  }

  async deactivate(id: string): Promise<Packaging> {
    const record = await this.prisma.packaging.update({ where: { id }, data: { isActive: false } });
    return this.toDomain(record);
  }

  async findSafetyDefault(tenantId: string): Promise<Packaging | null> {
    const record = await this.prisma.packaging.findFirst({
      where: { tenantId, isActive: true, purpose: 'SAFETY_DEFAULT' as never },
    });
    return record ? this.toDomain(record) : null;
  }

  async findAllMaster(tenantId: string): Promise<Packaging[]> {
    const records = await this.prisma.packaging.findMany({
      where: { tenantId, isActive: true, purpose: 'MASTER' as never },
      orderBy: { maxCapacityKg: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  // Converte o Decimal do Prisma para number na borda, mesmo padrão de
  // PrismaProductRepository.
  private toDomain(record: Record<string, unknown> & { costPrice: { toString(): string } }): Packaging {
    return {
      ...record,
      costPrice: Number(record.costPrice),
    } as Packaging;
  }
}
