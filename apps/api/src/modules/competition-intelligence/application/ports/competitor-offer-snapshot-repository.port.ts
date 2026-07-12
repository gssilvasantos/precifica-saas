// CompetitorOfferSnapshot — histórico append-only. Este repositório só
// ganha um método de escrita (createMany) porque é isso que o orquestrador
// precisa; leitura de histórico para Analytics é um port próprio do futuro
// módulo Analytics, não deste (ver nota em competitor-snapshot-reader.port.ts).

export interface OfferSnapshotCreateData {
  tenantId: string;
  skuCode: string;
  competitorLabel: string;
  price: number;
  isBuyBoxWinner?: boolean;
  sourceRadarCode: string;
  sourceEvidenceRef?: string;
  collectedAt: Date;
}

export interface CompetitorOfferSnapshotRepository {
  createMany(data: OfferSnapshotCreateData[]): Promise<void>;
}

export const COMPETITOR_OFFER_SNAPSHOT_REPOSITORY = Symbol('COMPETITOR_OFFER_SNAPSHOT_REPOSITORY');
