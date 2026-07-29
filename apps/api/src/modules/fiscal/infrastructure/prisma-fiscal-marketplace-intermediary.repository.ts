import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  FiscalMarketplaceIntermediaryRecord,
  FiscalMarketplaceIntermediaryRepository,
  FiscalMarketplaceIntermediaryUpsertData,
} from '../application/ports/fiscal-marketplace-intermediary-repository.port';

@Injectable()
export class PrismaFiscalMarketplaceIntermediaryRepository implements FiscalMarketplaceIntermediaryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantAndChannel(tenantId: string, channelCode: string): Promise<FiscalMarketplaceIntermediaryRecord | null> {
    const record = await this.prisma.fiscalMarketplaceIntermediary.findUnique({
      where: { tenantId_channelCode: { tenantId, channelCode } },
    });
    return record as FiscalMarketplaceIntermediaryRecord | null;
  }

  async findAllByTenant(tenantId: string): Promise<FiscalMarketplaceIntermediaryRecord[]> {
    const records = await this.prisma.fiscalMarketplaceIntermediary.findMany({ where: { tenantId }, orderBy: { channelCode: 'asc' } });
    return records as FiscalMarketplaceIntermediaryRecord[];
  }

  async upsert(data: FiscalMarketplaceIntermediaryUpsertData): Promise<FiscalMarketplaceIntermediaryRecord> {
    const record = await this.prisma.fiscalMarketplaceIntermediary.upsert({
      where: { tenantId_channelCode: { tenantId: data.tenantId, channelCode: data.channelCode } },
      create: data,
      update: { cnpj: data.cnpj, idCadIntTran: data.idCadIntTran },
    });
    return record as FiscalMarketplaceIntermediaryRecord;
  }

  async remove(tenantId: string, channelCode: string): Promise<void> {
    await this.prisma.fiscalMarketplaceIntermediary.deleteMany({ where: { tenantId, channelCode } });
  }
}
