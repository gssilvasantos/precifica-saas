import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  OlistConnectionRecord,
  OlistConnectionRepository,
} from '../application/ports/olist-connection-repository.port';

@Injectable()
export class PrismaOlistConnectionRepository implements OlistConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<OlistConnectionRecord | null> {
    return this.prisma.olistConnection.findUnique({
      where: { tenantId },
      select: { tenantId: true, apiTokenEnc: true, isActive: true, lastSyncedAt: true },
    });
  }

  findAllActive(): Promise<OlistConnectionRecord[]> {
    return this.prisma.olistConnection.findMany({
      where: { isActive: true },
      select: { tenantId: true, apiTokenEnc: true, isActive: true, lastSyncedAt: true },
    });
  }

  upsert(tenantId: string, apiTokenEnc: string): Promise<OlistConnectionRecord> {
    return this.prisma.olistConnection.upsert({
      where: { tenantId },
      create: { tenantId, apiTokenEnc, isActive: true },
      update: { apiTokenEnc, isActive: true },
      select: { tenantId: true, apiTokenEnc: true, isActive: true, lastSyncedAt: true },
    });
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.prisma.olistConnection.update({ where: { tenantId }, data: { isActive: false } });
  }

  async markSynced(tenantId: string, syncedAt: Date): Promise<void> {
    await this.prisma.olistConnection.update({ where: { tenantId }, data: { lastSyncedAt: syncedAt } });
  }
}
