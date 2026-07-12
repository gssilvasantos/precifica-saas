import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { WarehouseRepository } from '../application/ports/warehouse-repository.port';
import { Warehouse, WarehouseType, WarehouseUpsertData } from '../domain/warehouse.entity';

@Injectable()
export class PrismaWarehouseRepository implements WarehouseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Warehouse | null> {
    const record = await this.prisma.warehouse.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findByCode(tenantId: string, code: string): Promise<Warehouse | null> {
    const record = await this.prisma.warehouse.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<Warehouse[]> {
    const records = await this.prisma.warehouse.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  async upsert(data: WarehouseUpsertData): Promise<Warehouse> {
    const record = await this.prisma.warehouse.upsert({
      where: { tenantId_code: { tenantId: data.tenantId, code: data.code } },
      create: {
        tenantId: data.tenantId,
        code: data.code,
        type: data.type,
        channelCode: data.channelCode ?? null,
      },
      update: {
        type: data.type,
        channelCode: data.channelCode ?? null,
      },
    });
    return this.toDomain(record);
  }

  // tenantId é validado por quem chama (WarehouseService.updateLeadTimeDays
  // já confere ownership via findById antes) — mesmo padrão de
  // PrismaPackagingRepository.update (where: { id } só, sem tenantId
  // composto, porque `id` já é chave única e a validação de posse acontece
  // uma camada acima).
  async updateLeadTimeDays(tenantId: string, warehouseId: string, leadTimeDays: number): Promise<Warehouse> {
    const record = await this.prisma.warehouse.update({
      where: { id: warehouseId },
      data: { leadTimeDays },
    });
    return this.toDomain(record);
  }

  // Sprint 26 — mesmo racional isolado de updateLeadTimeDays acima.
  async updateLogisticsCostPerUnit(tenantId: string, warehouseId: string, logisticsCostPerUnit: number): Promise<Warehouse> {
    const record = await this.prisma.warehouse.update({
      where: { id: warehouseId },
      data: { logisticsCostPerUnit },
    });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    code: string;
    type: string;
    channelCode: string | null;
    isActive: boolean;
    leadTimeDays: number;
    logisticsCostPerUnit: { toString(): string };
    createdAt: Date;
    updatedAt: Date;
  }): Warehouse {
    return {
      id: record.id,
      tenantId: record.tenantId,
      code: record.code,
      type: record.type as WarehouseType,
      channelCode: record.channelCode,
      isActive: record.isActive,
      leadTimeDays: record.leadTimeDays,
      logisticsCostPerUnit: Number(record.logisticsCostPerUnit),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
