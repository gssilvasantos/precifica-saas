import { UnifiedOrderStatus } from '../../../../shared/contracts/marketplace-provider.contract';

// Função pura — nenhuma dependência de I/O, testável sem mock. Isolada do
// provider pelo mesmo motivo de calculateOpportunity/determineOrderTransitionEvents.
//
// AVISO DE HONESTIDADE (mesmo padrão de fetchGatewayFeeTable): a Nuvemshop
// expõe nativamente `status` (open/closed/cancelled), `payment_status`
// (pending/paid/partially_paid/refunded/voided/abandoned) e `shipping_status`
// (unpacked/shipped/delivered — nomenclatura pode variar por versão de API).
// Ela NÃO tem um conceito nativo de "Faturado" (emissão de NF-e é tipicamente
// feita por uma integração fiscal separada, fora da Nuvemshop). Por isso este
// mapeamento é uma HEURÍSTICA de MVP, documentada em
// docs/orders-architecture.md, seção 2:
//   - pedido pago mas ainda não despachado -> PREPARANDO_ENVIO (nunca
//     FATURADO automaticamente — FATURADO fica reservado para uma futura
//     integração fiscal marcar explicitamente, ou para atualização manual).
// Se o formato real da API divergir do assumido aqui, o pior caso é o pedido
// cair em EM_ABERTO (fail-safe: não avança pra frente sem confirmação clara).
export interface NuvemshopRawOrderStatus {
  status: string; // 'open' | 'closed' | 'cancelled' (ou variações)
  paymentStatus?: string; // 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'voided' | 'abandoned'
  shippingStatus?: string; // 'unpacked' | 'shipped' | 'delivered'
}

export function mapNuvemshopStatus(raw: NuvemshopRawOrderStatus): UnifiedOrderStatus {
  const status = raw.status?.toLowerCase();
  const paymentStatus = raw.paymentStatus?.toLowerCase();
  const shippingStatus = raw.shippingStatus?.toLowerCase();

  if (status === 'cancelled') {
    return 'CANCELADO';
  }

  if (shippingStatus === 'delivered' || status === 'closed') {
    return 'ENTREGUE';
  }

  if (shippingStatus === 'shipped') {
    return 'ENVIADO';
  }

  const isPaid = paymentStatus === 'paid' || paymentStatus === 'partially_paid';
  if (isPaid) {
    return 'PREPARANDO_ENVIO';
  }

  return 'EM_ABERTO';
}
