import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  NuvemshopConnectionRecord,
  NuvemshopConnectionRepository,
} from '../application/ports/nuvemshop-connection-repository.port';

@Injectable()
export class PrismaNuvemshopConnectionRepository implements NuvemshopConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<NuvemshopConnectionRecord | null> {
    return this.prisma.nuvemshopConnection.findUnique({ where: { tenantId } });
  }

  findAllActive(): Promise<NuvemshopConnectionRecord[]> {
    return this.prisma.nuvemshopConnection.findMany({ where: { isActive: true } });
  }

  upsert(tenantId: string, storeId: string, accessTokenEnc: string): Promise<NuvemshopConnectionRecord> {
    return this.prisma.nuvemshopConnection.upsert({
      where: { tenantId },
      create: { tenantId, storeId, accessTokenEnc, isActive: true },
      update: { storeId, accessTokenEnc, isActive: true },
    });
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.prisma.nuvemshopConnection.update({ where: { tenantId }, data: { isActive: false } });
  }

  async markSynced(tenantId: string, syncedAt: Date): Promise<void> {
    await this.prisma.nuvemshopConnection.update({ where: { tenantId }, data: { lastSyncedAt: syncedAt } });
  }
}
