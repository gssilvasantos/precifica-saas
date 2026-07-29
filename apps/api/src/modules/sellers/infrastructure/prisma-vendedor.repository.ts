import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { VendedorRepository } from '../application/ports/vendedor-repository.port';
import { Vendedor, VendedorCreateData, VendedorUpdateData } from '../domain/vendedor.entity';

@Injectable()
export class PrismaVendedorRepository implements VendedorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: VendedorCreateData): Promise<Vendedor> {
    const record = await this.prisma.vendedor.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        email: data.email ?? null,
        aliquotaComissaoPct: data.aliquotaComissaoPct,
        descontoMaximoPct: data.descontoMaximoPct ?? null,
        isActive: data.isActive ?? true,
      },
    });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<Vendedor | null> {
    const record = await this.prisma.vendedor.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Vendedor[]> {
    const records = await this.prisma.vendedor.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  async update(id: string, data: VendedorUpdateData): Promise<Vendedor> {
    const record = await this.prisma.vendedor.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.aliquotaComissaoPct !== undefined ? { aliquotaComissaoPct: data.aliquotaComissaoPct } : {}),
        ...(data.descontoMaximoPct !== undefined ? { descontoMaximoPct: data.descontoMaximoPct } : {}),
      },
    });
    return this.toDomain(record);
  }

  async setActive(id: string, isActive: boolean): Promise<Vendedor> {
    const record = await this.prisma.vendedor.update({ where: { id }, data: { isActive } });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    name: string;
    email: string | null;
    aliquotaComissaoPct: { toString(): string };
    descontoMaximoPct: { toString(): string } | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Vendedor {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      email: record.email,
      aliquotaComissaoPct: Number(record.aliquotaComissaoPct),
      descontoMaximoPct: record.descontoMaximoPct !== null ? Number(record.descontoMaximoPct) : null,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
