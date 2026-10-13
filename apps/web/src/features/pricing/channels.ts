// Metadados de identidade visual por canal — cores de referência pública das
// marcas (não validadas pixel a pixel contra guideline oficial). "connected"
// reflete o que o backend realmente sabe fazer hoje: ter ChannelListing +
// um serviço de simulação de margem ponta a ponta. Desde 13/10/2026 os três
// canais têm isso (simulateNuvemshopMargin/simulateMercadoLivreMargin/
// simulateShopeeMargin) — "connected" NÃO garante número real no cartão: se
// a regra de comissão ainda não foi validada em /governanca-marketplace
// (status PENDENTE_VALIDACAO), o simulador devolve feeRuleFound=false e o
// cartão mostra "sem regra validada", nunca um número inventado. Ver
// CatalogPricingCards.tsx.
export interface ChannelMeta {
  code: string;
  label: string;
  initial: string;
  brandColor: string;
  brandInk: string;
  connected: boolean;
}

export const CHANNELS: ChannelMeta[] = [
  { code: 'NUVEMSHOP', label: 'Nuvemshop', initial: 'N', brandColor: '#4A25AA', brandInk: '#FFFFFF', connected: true },
  { code: 'MERCADO_LIVRE', label: 'Mercado Livre', initial: 'ML', brandColor: '#FFE600', brandInk: '#2D3277', connected: true },
  { code: 'SHOPEE', label: 'Shopee', initial: 'S', brandColor: '#EE4D2D', brandInk: '#FFFFFF', connected: true },
];
