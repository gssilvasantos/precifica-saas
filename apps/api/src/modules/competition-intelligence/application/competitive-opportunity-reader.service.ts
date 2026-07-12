import { Inject, Injectable } from '@nestjs/common';
import {
  COMPETITIVE_OPPORTUNITY_REPOSITORY,
  CompetitiveOpportunityRepository,
} from './ports/competitive-opportunity-repository.port';
import {
  CompetitiveOpportunitySummary,
  CompetitorSnapshotReader,
} from '../../../shared/contracts/competitor-snapshot-reader.port';

// Implementação da porta CompetitorSnapshotReader (shared/contracts/) —
// consumida pelo Pricing Intelligence. Só este módulo sabe da tabela
// CompetitiveOpportunity (e nunca expõe CompetitorOfferSnapshot, o
// histórico bruto, através desta porta — ver nota no port).
@Injectable()
export class CompetitiveOpportunityReaderService implements CompetitorSnapshotReader {
  constructor(
    @Inject(COMPETITIVE_OPPORTUNITY_REPOSITORY) private readonly opportunities: CompetitiveOpportunityRepository,
  ) {}

  async findOpportunity(tenantId: string, skuCode: string): Promise<CompetitiveOpportunitySummary | null> {
    const record = await this.opportunities.findByTenantAndSku(tenantId, skuCode);
    if (!record) return null;
    return {
      skuCode: record.skuCode,
      bestCompetitorPrice: record.bestCompetitorPrice,
      bestCompetitorLabel: record.bestCompetitorLabel,
      ourPrice: record.ourPrice,
      channelCode: record.channelCode,
      priceGapPct: record.priceGapPct,
      buyBoxStatus: record.buyBoxStatus,
      rank: record.rank,
      detectedAt: record.detectedAt,
    };
  }
}
