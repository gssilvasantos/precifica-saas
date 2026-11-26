// Contrato do "radar de concorrência" — agnóstico à fonte do dado (scraping,
// API de parceiro tipo PriceAPI, ou monitoramento interno alimentado à mão).
// Um único método, de propósito: ao contrário do MarketplaceProvider (que
// tem várias capacidades segregadas porque cada canal tem uma superfície de
// API bem diferente), aqui existe exatamente UMA operação que todo radar,
// não importa a fonte, precisa saber fazer — "me diga as ofertas que você
// enxergou para este alvo". Isso é o pedido explícito de ser "agnóstico
// quanto à fonte da informação".
//
// Ver docs/competition-intelligence-architecture.md, seção 2.

export interface RawCompetitorOffer {
  competitorLabel: string;
  price: number;
  isBuyBoxWinner?: boolean;
  collectedAt: Date;
  sourceEvidenceRef?: string; // URL/id da coleta específica, para auditoria
}

export interface CompetitionFetchContext {
  tenantId: string;
  skuCode: string;
  targetRef: string; // URL ou identificador que o radar usa para saber o que buscar (vem de MonitoredCompetitorListing)
  // Incidente PolicyAgent (25/11/2026, ver comentário de MAX_CONSECUTIVE_FAILURES
  // em competition-monitor-orchestrator.service.ts): o radar de Mercado Livre
  // passou a resolver o próprio anúncio (via ChannelListingReader) para usar
  // GET /items/{id}/price_to_win em vez de /products/{id}/items — precisa do
  // canal pra fazer essa resolução. null/undefined = sem canal vinculado, radar
  // cai no caminho antigo (produto de catálogo, sem price_to_win).
  channelCode?: string | null;
}

export interface RadarHealthStatus {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  message?: string;
}

export interface CompetitionRadar {
  readonly code: string; // ex.: "PRICEAPI_V1", "MANUAL_SHEET_IMPORT"
  readonly sourceType: 'SCRAPING' | 'PARTNER_API' | 'INTERNAL_MONITORING';
  fetchOffers(ctx: CompetitionFetchContext): Promise<RawCompetitorOffer[]>;
  healthCheck(): Promise<RadarHealthStatus>;
}
