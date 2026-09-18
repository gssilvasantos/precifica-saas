// Mesma convenção de eventos de domínio do resto da plataforma (ver
// catalog/domain/packaging-events.ts) — existe para que o Competition
// Intelligence possa reagir a "os anúncios do Mercado Livre deste tenant
// foram sincronizados" sem o Marketplace Intelligence precisar conhecer
// MonitoredCompetitorListing nem nenhuma classe daquele módulo. Import de
// mão única: quem importa este arquivo (puro dado, zero I/O) é o listener do
// OUTRO módulo, nunca o contrário.
//
// Por que isto existe (18/09/2026, ativação do radar de catálogo para
// tenants reais): sincronizar ChannelListing sozinho não "liga o radar" —
// o MercadoLivreCatalogRadar só lê o que estiver cadastrado em
// MonitoredCompetitorListing (ver mercado-livre-catalog-radar.ts). Sem este
// evento, cada anúncio novo do vendedor ficaria de fora do monitoramento até
// alguém cadastrar manualmente pela tela "Radar de Concorrência" — o motor
// existe, mas fica sem combustível para produtos novos. O listener (Competition
// Intelligence) usa este sinal para reconciliar automaticamente: todo anúncio
// deste payload sem MonitoredCompetitorListing correspondente ganha um
// registro novo (radarCode MERCADO_LIVRE_CATALOG_V1).
//
// O payload carrega a LISTA de anúncios sincronizados nesta rodada (não só o
// tenantId) de propósito: assim o listener nunca precisa ler ChannelListing
// diretamente (nem por uma porta nova) para saber o que reconciliar — recebe
// exatamente os dados que precisa, e nada além disso (minimização de dado,
// ver CLAUDE.md §6). MercadoLivreChannelListingSyncService.syncTenant sempre
// varre TODOS os anúncios do vendedor a cada execução (nunca só os novos —
// ver o próprio serviço), então este evento, disparado a cada sync bem
// sucedido, também funciona como reconciliação periódica: um anúncio que por
// algum motivo não virou MonitoredCompetitorListing numa rodada é
// reconsiderado na próxima, sem exigir nenhuma ação manual.
export const CHANNEL_LISTING_EVENTS = {
  MERCADO_LIVRE_SYNCED: 'marketplace-intelligence.mercado-livre-channel-listings-synced',
} as const;

export interface SyncedChannelListing {
  skuCode: string;
  externalId: string;
}

export interface MercadoLivreChannelListingsSyncedEvent {
  tenantId: string;
  listings: SyncedChannelListing[];
}
