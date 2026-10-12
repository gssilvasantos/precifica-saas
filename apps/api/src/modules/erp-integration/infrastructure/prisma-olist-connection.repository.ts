import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  OlistConnectionRecord,
  OlistConnectionRepository,
  OlistV3TokenRecord,
  OlistV3TokenWrite,
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
    resumeFromPage: true,
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

  async saveProgress(tenantId: string, resumeFromPage: number | null): Promise<void> {
    await this.prisma.olistConnection.update({
      where: { tenantId },
      data: { resumeFromPage },
    });
  }

  async findV3Tokens(tenantId: string): Promise<OlistV3TokenRecord | null> {
    const row = await this.prisma.olistConnection.findUnique({
      where: { tenantId },
      select: {
        v3AccessTokenEnc: true,
        v3RefreshTokenEnc: true,
        v3AccessExpiresAt: true,
        v3RefreshExpiresAt: true,
        v3ConnectedAt: true,
      },
    });
    if (!row?.v3AccessTokenEnc || !row.v3RefreshTokenEnc || !row.v3AccessExpiresAt) return null;
    return {
      accessTokenEnc: row.v3AccessTokenEnc,
      refreshTokenEnc: row.v3RefreshTokenEnc,
      accessExpiresAt: row.v3AccessExpiresAt,
      refreshExpiresAt: row.v3RefreshExpiresAt,
      connectedAt: row.v3ConnectedAt,
    };
  }

  // updateMany (e não update): devolve contagem 0 em vez de lançar quando a conta
  // não tem linha, e o tenantId no where mantém o escopo explícito além do RLS.
  async saveV3Tokens(tenantId: string, tokens: OlistV3TokenWrite, markConnected: boolean): Promise<boolean> {
    const result = await this.prisma.olistConnection.updateMany({
      where: { tenantId },
      data: {
        v3AccessTokenEnc: tokens.accessTokenEnc,
        v3RefreshTokenEnc: tokens.refreshTokenEnc,
        v3AccessExpiresAt: tokens.accessExpiresAt,
        v3RefreshExpiresAt: tokens.refreshExpiresAt,
        ...(markConnected ? { v3ConnectedAt: new Date() } : {}),
      },
    });
    return result.count > 0;
  }

  async clearV3Tokens(tenantId: string): Promise<void> {
    await this.prisma.olistConnection.updateMany({
      where: { tenantId },
      data: {
        v3AccessTokenEnc: null,
        v3RefreshTokenEnc: null,
        v3AccessExpiresAt: null,
        v3RefreshExpiresAt: null,
        v3ConnectedAt: null,
      },
    });
  }
}
