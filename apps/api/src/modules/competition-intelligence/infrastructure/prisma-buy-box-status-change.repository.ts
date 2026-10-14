import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  BuyBoxStatusChangeCreateData,
  BuyBoxStatusChangeRecord,
  BuyBoxStatusChangeRepository,
  FindBuyBoxTransitionsFilter,
} from '../application/ports/buy-box-status-change-repository.port';

@Injectable()
export class PrismaBuyBoxStatusChangeRepository implements BuyBoxStatusChangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: BuyBoxStatusChangeCreateData): Promise<void> {
    await this.prisma.competitiveOpportunityStatusChange.create({ data });
  }

  async findByTenant(filter: FindBuyBoxTransitionsFilter): Promise<BuyBoxStatusChangeRecord[]> {
    const records = await this.prisma.competitiveOpportunityStatusChange.findMany({
      where: {
        tenantId: filter.tenantId,
        ...(filter.newStatus ? { newStatus: filter.newStatus } : {}),
        ...(filter.skuCode ? { skuCode: filter.skuCode } : {}),
        ...(filter.detectedSince ? { detectedAt: { gte: filter.detectedSince } } : {}),
      },
      orderBy: { detectedAt: 'desc' },
      take: filter.limit,
    });
    return records.map((r) => this.toDomain(r));
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.competitiveOpportunityStatusChange.deleteMany({
      where: { detectedAt: { lt: cutoff } },
    });
    return count;
  }

  private toDomain(record: {
    id: string;
    tenantId: string;
    skuCode: string;
    channelCode: string | null;
    previousStatus: string | null;
    newStatus: string;
    ourPrice: { toString(): string } | null;
    bestCompetitorPrice: { toString(): string };
    bestCompetitorLabel: string;
    priceGapPct: number;
    rank: number | null;
    detectedAt: Date;
  }): BuyBoxStatusChangeRecord {
    return {
      id: record.id,
      tenantId: record.tenantId,
      skuCode: record.skuCode,
      channelCode: record.channelCode,
      previousStatus: record.previousStatus as BuyBoxStatusChangeRecord['previousStatus'],
      newStatus: record.newStatus as BuyBoxStatusChangeRecord['newStatus'],
      ourPrice: record.ourPrice !== null ? Number(record.ourPrice) : null,
      bestCompetitorPrice: Number(record.bestCompetitorPrice),
      bestCompetitorLabel: record.bestCompetitorLabel,
      priceGapPct: record.priceGapPct,
      rank: record.rank,
      detectedAt: record.detectedAt,
    };
  }
}
