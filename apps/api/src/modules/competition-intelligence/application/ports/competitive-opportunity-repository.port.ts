// CompetitiveOpportunity — read-model enxuto, upsert por (tenantId, skuCode).
// Mesma disciplina "latest known state" do ErpSyncChangeEvent.

export interface CompetitiveOpportunityRecord {
  tenantId: string;
  skuCode: string;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  ourPrice: number | null;
  channelCode: string | null;
  priceGapPct: number;
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null;
  detectedAt: Date;
}

export interface CompetitiveOpportunityUpsertData {
  tenantId: string;
  skuCode: string;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  ourPrice: number | null;
  channelCode: string | null;
  priceGapPct: number;
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null;
  detectedAt: Date;
}

export interface CompetitiveOpportunityRepository {
  upsert(data: CompetitiveOpportunityUpsertData): Promise<void>;
  findByTenantAndSku(tenantId: string, skuCode: string): Promise<CompetitiveOpportunityRecord | null>;
  findAllByTenant(tenantId: string): Promise<CompetitiveOpportunityRecord[]>;
}

export const COMPETITIVE_OPPORTUNITY_REPOSITORY = Symbol('COMPETITIVE_OPPORTUNITY_REPOSITORY');
