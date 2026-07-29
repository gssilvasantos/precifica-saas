import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  FiscalSettingsRecord,
  FiscalSettingsRepository,
  FiscalSettingsUpsertData,
} from '../application/ports/fiscal-settings-repository.port';

@Injectable()
export class PrismaFiscalSettingsRepository implements FiscalSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenant(tenantId: string): Promise<FiscalSettingsRecord | null> {
    const record = await this.prisma.fiscalSettings.findUnique({ where: { tenantId } });
    return record as FiscalSettingsRecord | null;
  }

  async upsert(data: FiscalSettingsUpsertData): Promise<FiscalSettingsRecord> {
    const record = await this.prisma.fiscalSettings.upsert({
      where: { tenantId: data.tenantId },
      create: data as never,
      update: data as never,
    });
    return record as FiscalSettingsRecord;
  }
}
