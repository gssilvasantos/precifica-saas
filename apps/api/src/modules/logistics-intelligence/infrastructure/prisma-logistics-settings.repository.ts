import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  LogisticsSettings,
  LogisticsSettingsRepository,
} from '../application/ports/logistics-settings-repository.port';

@Injectable()
export class PrismaLogisticsSettingsRepository implements LogisticsSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTenant(tenantId: string): Promise<LogisticsSettings | null> {
    return this.prisma.logisticsSettings.findUnique({ where: { tenantId } });
  }

  upsert(tenantId: string, cubicWeightFactor: number): Promise<LogisticsSettings> {
    return this.prisma.logisticsSettings.upsert({
      where: { tenantId },
      create: { tenantId, cubicWeightFactor },
      update: { cubicWeightFactor },
    });
  }
}
