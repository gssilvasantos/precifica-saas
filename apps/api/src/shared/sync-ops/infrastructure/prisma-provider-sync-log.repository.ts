import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderSyncLogRepository } from '../ports/provider-sync-log-repository.port';

@Injectable()
export class PrismaProviderSyncLogRepository implements ProviderSyncLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async start(providerCode: string, correlationId: string): Promise<string> {
    const log = await this.prisma.providerSyncLog.create({
      data: { providerCode, correlationId, status: 'SUCCESS' }, // status provisório, atualizado em finish()
    });
    return log.id;
  }

  async finish(
    logId: string,
    result: {
      status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
      candidatesFound: number;
      candidatesApplied: number;
      errorDetails?: string;
    },
  ): Promise<void> {
    await this.prisma.providerSyncLog.update({
      where: { id: logId },
      data: { ...result, finishedAt: new Date() },
    });
  }
}
