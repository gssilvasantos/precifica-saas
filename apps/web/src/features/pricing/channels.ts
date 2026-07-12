// Metadados de identidade visual por canal — cores de referência pública das
// marcas (não validadas pixel a pixel contra guideline oficial). "connected"
// reflete o que o backend realmente sabe fazer hoje: só a Nuvemshop tem
// ChannelListing + regra de taxa de gateway ponta a ponta (Etapa 5.1).
// Mercado Livre e Shopee aparecem no grid (a visão do produto sempre mostra
// todos os canais relevantes) mas como "aguardando integração" — nunca com
// número inventado.
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
  { code: 'MERCADO_LIVRE', label: 'Mercado Livre', initial: 'ML', brandColor: '#FFE600', brandInk: '#2D3277', connected: false },
  { code: 'SHOPEE', label: 'Shopee', initial: 'S', brandColor: '#EE4D2D', brandInk: '#FFFFFF', connected: false },
];
