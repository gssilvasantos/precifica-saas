import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ReceivableRecordRepository } from '../application/ports/receivable-record-repository.port';
import {
  ReceivableMarkPaidData,
  ReceivableRecord,
  ReceivableRecordCreateData,
  ReceivableStatus,
} from '../domain/receivable-record.entity';

@Injectable()
export class PrismaReceivableRecordRepository implements ReceivableRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: ReceivableRecordCreateData): Promise<ReceivableRecord> {
    const record = await this.prisma.receivableRecord.create({ data: data as never });
    return this.toDomain(record);
  }

  async findById(tenantId: string, id: string): Promise<ReceivableRecord | null> {
    const record = await this.prisma.receivableRecord.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findByStatus(tenantId: string, status: ReceivableStatus): Promise<ReceivableRecord[]> {
    const records = await this.prisma.receivableRecord.findMany({
      where: { tenantId, status: status as never },
      orderBy: { expectedDate: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findByExternalReference(
    tenantId: string,
    marketplaceSource: string,
    externalReference: string,
  ): Promise<ReceivableRecord | null> {
    const record = await this.prisma.receivableRecord.findFirst({
      where: { tenantId, marketplaceSource, externalReference },
    });
    return record ? this.toDomain(record) : null;
  }

  async markPaid(id: string, data: ReceivableMarkPaidData): Promise<ReceivableRecord> {
    const record = await this.prisma.receivableRecord.update({ where: { id }, data: data as never });
    return this.toDomain(record);
  }

  async cancel(id: string): Promise<ReceivableRecord> {
    const record = await this.prisma.receivableRecord.update({
      where: { id },
      data: { status: 'CANCELLED' } as never,
    });
    return this.toDomain(record);
  }

  private toDomain(record: Record<string, unknown> & { amount: { toString(): string } }): ReceivableRecord {
    return {
      ...record,
      amount: Number(record.amount),
    } as ReceivableRecord;
  }
}
