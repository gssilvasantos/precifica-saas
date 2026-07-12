import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  CompetitiveOpportunityRecord,
  CompetitiveOpportunityRepository,
  CompetitiveOpportunityUpsertData,
} from '../application/ports/competitive-opportunity-repository.port';

@Injectable()
export class PrismaCompetitiveOpportunityRepository implements CompetitiveOpportunityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: CompetitiveOpportunityUpsertData): Promise<void> {
    await this.prisma.competitiveOpportunity.upsert({
      where: { tenantId_skuCode: { tenantId: data.tenantId, skuCode: data.skuCode } },
      create: data,
      update: data,
    });
  }

  async findByTenantAndSku(tenantId: string, skuCode: string): Promise<CompetitiveOpportunityRecord | null> {
    const record = await this.prisma.competitiveOpportunity.findUnique({
      where: { tenantId_skuCode: { tenantId, skuCode } },
    });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string): Promise<CompetitiveOpportunityRecord[]> {
    const records = await this.prisma.competitiveOpportunity.findMany({ where: { tenantId }, orderBy: { skuCode: 'asc' } });
    return records.map((r) => this.toDomain(r));
  }

  private toDomain(record: {
    tenantId: string;
    skuCode: string;
    bestCompetitorPrice: { toString(): string };
    bestCompetitorLabel: string;
    ourPrice: { toString(): string } | null;
    channelCode: string | null;
    priceGapPct: number;
    buyBoxStatus: string;
    rank: number | null;
    detectedAt: Date;
  }): CompetitiveOpportunityRecord {
    return {
      tenantId: record.tenantId,
      skuCode: record.skuCode,
      bestCompetitorPrice: Number(record.bestCompetitorPrice),
      bestCompetitorLabel: record.bestCompetitorLabel,
      ourPrice: record.ourPrice !== null ? Number(record.ourPrice) : null,
      channelCode: record.channelCode,
      priceGapPct: record.priceGapPct,
      buyBoxStatus: record.buyBoxStatus as CompetitiveOpportunityRecord['buyBoxStatus'],
      rank: record.rank,
      detectedAt: record.detectedAt,
    };
  }
}
