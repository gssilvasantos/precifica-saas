import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ErpSyncChangeEvent,
  ErpSyncChangeEventRepository,
  ErpSyncChangeEventUpsertData,
} from '../application/ports/erp-sync-change-event-repository.port';

@Injectable()
export class PrismaErpSyncChangeEventRepository implements ErpSyncChangeEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: ErpSyncChangeEventUpsertData): Promise<void> {
    await this.prisma.erpSyncChangeEvent.upsert({
      where: { tenantId_externalId: { tenantId: data.tenantId, externalId: data.externalId } },
      create: { ...data, syncedAt: new Date() },
      update: { ...data, syncedAt: new Date() },
    });
  }

  findByExternalId(tenantId: string, externalId: string): Promise<ErpSyncChangeEvent | null> {
    return this.prisma.erpSyncChangeEvent.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
    }) as unknown as Promise<ErpSyncChangeEvent | null>;
  }

  findRecent(tenantId: string, limit = 50): Promise<ErpSyncChangeEvent[]> {
    return this.prisma.erpSyncChangeEvent.findMany({
      where: { tenantId },
      orderBy: { syncedAt: 'desc' },
      take: limit,
    }) as unknown as Promise<ErpSyncChangeEvent[]>;
  }
}
