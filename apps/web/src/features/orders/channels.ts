// Identidade visual dos 7 canais do hub multicanal (Etapa 17,
// docs/orders-architecture.md, seção 11). Cores de referência pública das
// marcas — mesmo aviso de honestidade de features/pricing/channels.ts, não
// validadas pixel a pixel contra guideline oficial.
//
// AVISO DE HONESTIDADE — ATUALIZADO em 27/07/2026: NUVEMSHOP,
// MERCADO_LIVRE e SHOPEE têm adapter real (`NuvemshopOrderProvider`/
// `MercadoLivreOrderProvider`/`ShopeeOrderProvider`) — os outros 4 códigos
// abaixo são os canais que a arquitetura do provider já suporta plugar
// (Interface Segregation via `OrderCapableProvider`, ver
// docs/orders-architecture.md §11.1), mas ainda SEM implementação. Aparecem
// no filtro/badge porque o pedido do usuário foi que a UI já reflita o hub
// completo — a tabela simplesmente não vai retornar pedidos desses canais
// até o respectivo provider existir.
//
// `providerCode` (novo) — só existe para canais com sync REAL de pedidos;
// usado pelo botão "Sincronizar agora" (OrderTable.tsx) para saber qual
// provider disparar via POST /orders/providers/:providerCode/sync. Mesmo
// código registrado em MercadoLivreOrderProvider.code/NuvemshopOrderProvider.code
// no backend — duplicado aqui de propósito, mesmo racional de todo o
// restante deste arquivo (frontend não importa tipo do backend).
export interface OrderChannelMeta {
  code: string;
  label: string;
  initial: string;
  brandColor: string;
  brandInk: string;
  implemented: boolean;
  providerCode?: string;
}

export const ORDER_CHANNELS: OrderChannelMeta[] = [
  {
    code: 'NUVEMSHOP',
    label: 'Nuvemshop',
    initial: 'N',
    brandColor: '#4A25AA',
    brandInk: '#FFFFFF',
    implemented: true,
    providerCode: 'NUVEMSHOP_ORDERS',
  },
  {
    code: 'MERCADO_LIVRE',
    label: 'Mercado Livre',
    initial: 'ML',
    brandColor: '#FFE600',
    brandInk: '#2D3277',
    implemented: true,
    providerCode: 'MERCADO_LIVRE_ORDERS',
  },
  {
    code: 'SHOPEE',
    label: 'Shopee',
    initial: 'S',
    brandColor: '#EE4D2D',
    brandInk: '#FFFFFF',
    implemented: true,
    providerCode: 'SHOPEE_ORDERS',
  },
  { code: 'TIKTOK_SHOP', label: 'TikTok Shop', initial: 'TT', brandColor: '#000000', brandInk: '#FFFFFF', implemented: false },
  { code: 'AMAZON', label: 'Amazon', initial: 'A', brandColor: '#FF9900', brandInk: '#131921', implemented: false },
  { code: 'MAGALU', label: 'Magalu', initial: 'M', brandColor: '#0086FF', brandInk: '#FFFFFF', implemented: false },
  { code: 'SHEIN', label: 'SHEIN', initial: 'SH', brandColor: '#000000', brandInk: '#FFFFFF', implemented: false },
];

export function getChannelMeta(code: string): OrderChannelMeta {
  return (
    ORDER_CHANNELS.find((c) => c.code === code) ?? {
      code,
      label: code,
      initial: code.slice(0, 2).toUpperCase(),
      brandColor: '#D4D4D8',
      brandInk: '#3F3F46',
      implemented: false,
    }
  );
}
