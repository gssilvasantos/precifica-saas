import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ProviderSyncSchedule,
  ProviderSyncScheduleRepository,
} from '../ports/provider-sync-schedule-repository.port';

@Injectable()
export class PrismaProviderSyncScheduleRepository implements ProviderSyncScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDue(now: Date): Promise<ProviderSyncSchedule[]> {
    const schedules = await this.prisma.providerSyncSchedule.findMany({ where: { isEnabled: true } });
    return schedules.filter((s) => {
      if (!s.lastRunAt) return true;
      const dueAt = new Date(s.lastRunAt.getTime() + s.intervalMinutes * 60_000);
      return dueAt <= now;
    });
  }

  findByProviderCode(providerCode: string): Promise<ProviderSyncSchedule | null> {
    return this.prisma.providerSyncSchedule.findUnique({ where: { providerCode } });
  }

  async markRun(id: string, status: string, ranAt: Date): Promise<void> {
    await this.prisma.providerSyncSchedule.update({
      where: { id },
      data: { lastRunAt: ranAt, lastRunStatus: status },
    });
  }

  upsert(data: {
    providerCode: string;
    marketplaceId: string;
    capability: string;
    intervalMinutes: number;
    autoTrust?: boolean;
  }): Promise<ProviderSyncSchedule> {
    return this.prisma.providerSyncSchedule.upsert({
      where: { providerCode: data.providerCode },
      create: { ...data, autoTrust: data.autoTrust ?? false },
      update: { intervalMinutes: data.intervalMinutes, autoTrust: data.autoTrust },
    });
  }
}
