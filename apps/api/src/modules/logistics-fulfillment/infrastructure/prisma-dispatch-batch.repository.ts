import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { DispatchBatch, DispatchBatchStatus } from '../domain/dispatch-batch.entity';
import { DispatchBatchCreateData, DispatchBatchRepository } from '../application/ports/dispatch-batch-repository.port';

@Injectable()
export class PrismaDispatchBatchRepository implements DispatchBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: DispatchBatchCreateData): Promise<DispatchBatch> {
    const record = await this.prisma.dispatchBatch.create({
      data: {
        tenantId: data.tenantId,
        formaEnvio: data.formaEnvio,
        requestedByUserId: data.requestedByUserId ?? null,
        notes: data.notes ?? null,
      },
    });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<DispatchBatch | null> {
    const record = await this.prisma.dispatchBatch.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string, status?: DispatchBatchStatus): Promise<DispatchBatch[]> {
    const records = await this.prisma.dispatchBatch.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async updateStatus(id: string, status: DispatchBatchStatus, concludedAt?: Date | null): Promise<DispatchBatch> {
    const record = await this.prisma.dispatchBatch.update({
      where: { id },
      data: { status, concludedAt: concludedAt ?? undefined },
    });
    return this.toDomain(record);
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    formaEnvio: string;
    status: string;
    requestedByUserId: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    concludedAt: Date | null;
  }): DispatchBatch {
    return {
      id: record.id,
      tenantId: record.tenantId,
      formaEnvio: record.formaEnvio,
      status: record.status as DispatchBatchStatus,
      requestedByUserId: record.requestedByUserId,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      concludedAt: record.concludedAt,
    };
  }
}
