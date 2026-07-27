import { UnifiedOrderStatus } from '../../../../../shared/contracts/marketplace-provider.contract';

// Função pura — mesmo racional de mapMercadoLivreStatus/mapNuvemshopStatus:
// zero I/O, testável sem mock, isolada do provider.
//
// AVISO DE HONESTIDADE: mapeamento baseado na documentação pública do
// Shopee Open Platform v2 (valores de `order_status` do get_order_list/
// get_order_detail) — nunca validado contra um pedido real (ver aviso em
// shopee-api-client.ts, seção de pedidos). A Shopee, assim como o Mercado
// Livre e a Nuvemshop, não tem um estágio nativo de "Faturado" (NF-e é
// emissão do vendedor) — nunca inferido automaticamente.
export function mapShopeeOrderStatus(rawStatus: string): UnifiedOrderStatus {
  const status = rawStatus?.toUpperCase();

  switch (status) {
    case 'UNPAID':
      return 'EM_ABERTO';
    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'INVOICE_PENDING':
      return 'PREPARANDO_ENVIO';
    case 'SHIPPED':
      return 'ENVIADO';
    case 'COMPLETED':
      return 'ENTREGUE';
    // TO_RETURN: item já foi entregue e o comprador solicitou devolução —
    // mantido como ENTREGUE de propósito (o pedido chegou ao comprador; a
    // devolução em si não tem um status unificado dedicado ainda, mesma
    // limitação aceita nos demais canais).
    case 'TO_RETURN':
      return 'ENTREGUE';
    case 'CANCELLED':
    case 'IN_CANCEL':
      return 'CANCELADO';
    default:
      // Status desconhecido/futuro da Shopee — nunca assumimos "cancelado"
      // ou "entregue" por padrão (silenciosamente esconderia um pedido ativo
      // de verdade); cai no estágio mais conservador.
      return 'EM_ABERTO';
  }
}
