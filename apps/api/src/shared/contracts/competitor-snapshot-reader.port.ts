// Porta de leitura exportada pelo Competition Intelligence, consumida pelo
// Pricing Engine (e, no futuro, por Analytics via uma porta própria — ver
// nota no fim deste arquivo). Nome já previsto em
// docs/platform-architecture.md, seção 3.
//
// Deliberadamente enxuta: expõe só a ÚLTIMA leitura processada por SKU
// (tabela CompetitiveOpportunity, O(1) por SKU), nunca o histórico bruto
// (CompetitorOfferSnapshot). O Pricing Engine decide reação com base em
// "qual é a situação agora", não em série temporal — isso é problema do
// Analytics, que quando existir vai ganhar sua própria porta de leitura
// (ex.: CompetitorHistoryReader) apontando para a tabela de histórico,
// sem que o Pricing Engine precise saber que ela existe.

export interface CompetitiveOpportunitySummary {
  skuCode: string;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  ourPrice: number | null;
  // Canal usado para resolver ourPrice (o channelCode do MonitoredCompetitorListing
  // que gerou esta leitura) — nulo pela mesma razão que ourPrice pode ser
  // nulo. O consumidor (Pricing Intelligence) usa isso para saber ONDE
  // aplicar uma decisão de preço via PRICE_UPDATE_DISPATCHER.
  channelCode: string | null;
  priceGapPct: number;
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null;
  detectedAt: Date;
}

export interface CompetitorSnapshotReader {
  findOpportunity(tenantId: string, skuCode: string): Promise<CompetitiveOpportunitySummary | null>;
}
