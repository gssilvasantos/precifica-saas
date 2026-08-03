import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  OlistConnectionRecord,
  OlistConnectionRepository,
} from '../application/ports/olist-connection-repository.port';

@Injectable()
export class PrismaOlistConnectionRepository implements OlistConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private readonly select = {
    tenantId: true,
    apiTokenEnc: true,
    isActive: true,
    lastSyncedAt: true,
    lastSyncStatus: true,
    lastSyncError: true,
  } as const;

  findByTenant(tenantId: string): Promise<OlistConnectionRecord | null> {
    return this.prisma.olistConnection.findUnique({ where: { tenantId }, select: this.select });
  }

  findAllActive(): Promise<OlistConnectionRecord[]> {
    return this.prisma.olistConnection.findMany({ where: { isActive: true }, select: this.select });
  }

  upsert(tenantId: string, apiTokenEnc: string): Promise<OlistConnectionRecord> {
    return this.prisma.olistConnection.upsert({
      where: { tenantId },
      create: { tenantId, apiTokenEnc, isActive: true },
      update: { apiTokenEnc, isActive: true },
      select: this.select,
    });
  }

  async deactivate(tenantId: string): Promise<void> {
    await this.prisma.olistConnection.update({ where: { tenantId }, data: { isActive: false } });
  }

  async markSynced(tenantId: string, syncedAt: Date): Promise<void> {
    await this.prisma.olistConnection.update({
      where: { tenantId },
      data: { lastSyncedAt: syncedAt, lastSyncStatus: 'SUCCESS', lastSyncError: null },
    });
  }

  // Terceiro estado (02/08/2026): o sync rodou e importou, mas parte do
  // catálogo ficou de fora. Nem SUCCESS (esconderia o que falhou) nem
  // FAILED (esconderia o que funcionou, e faria o usuário achar que nada
  // entrou). `lastSyncedAt` é atualizado porque a sincronização de fato
  // aconteceu.
  async markSyncedWithWarning(tenantId: string, syncedAt: Date, warning: string): Promise<void> {
    await this.prisma.olistConnection.update({
      where: { tenantId },
      data: { lastSyncedAt: syncedAt, lastSyncStatus: 'PARTIAL', lastSyncError: warning },
    });
  }

  async markSyncFailed(tenantId: string, error: string): Promise<void> {
    await this.prisma.olistConnection.update({
      where: { tenantId },
      data: { lastSyncStatus: 'FAILED', lastSyncError: error },
    });
  }
}
