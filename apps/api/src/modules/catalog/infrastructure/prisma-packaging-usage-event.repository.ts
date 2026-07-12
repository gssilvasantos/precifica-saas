import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PackagingUsageEventRepository } from '../application/ports/packaging-usage-event-repository.port';
import { PackagingUsageEvent, PackagingUsageEventCreateData } from '../domain/packaging-usage-event.entity';

@Injectable()
export class PrismaPackagingUsageEventRepository implements PackagingUsageEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: PackagingUsageEventCreateData): Promise<PackagingUsageEvent> {
    const record = await this.prisma.packagingUsageEvent.create({ data });
    return this.toDomain(record);
  }

  async findByProduct(tenantId: string, productId: string): Promise<PackagingUsageEvent[]> {
    const records = await this.prisma.packagingUsageEvent.findMany({
      where: { tenantId, productId },
      orderBy: { occurredAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  // Mesmo padrão de conversão Decimal -> number de PrismaPackagingRepository.
  private toDomain(record: Record<string, unknown> & { unitCostPrice: { toString(): string } }): PackagingUsageEvent {
    return {
      ...record,
      unitCostPrice: Number(record.unitCostPrice),
    } as PackagingUsageEvent;
  }
}
