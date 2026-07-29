import { UnifiedOrderStatus } from '../../../../../shared/contracts/marketplace-provider.contract';

// Função pura — mesmo racional de mapNuvemshopStatus (erp-integration/infrastructure/nuvemshop/nuvemshop-order-status.mapper.ts):
// zero I/O, testável sem mock, isolada do provider.
//
// AVISO DE HONESTIDADE (Sprint 21): este mapeamento segue a documentação
// pública da API de Pedidos do Mercado Livre (https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas),
// mas NUNCA foi validado contra uma chamada ao vivo — a captura real de
// pedidos do Mercado Livre exige OAuth2 por vendedor, que ainda não está
// implementado (ver mercado-livre-order.provider.ts). Enquanto isso, esta
// função só é exercida pelos testes unitários com payloads de exemplo.
// Igual à Nuvemshop, o Mercado Livre não tem um estágio nativo de "Faturado"
// (NF-e é emissão do vendedor, fora do escopo da API do canal) — nunca
// inferido automaticamente.
export interface MercadoLivreRawOrderStatus {
  status: string; // 'confirmed' | 'payment_required' | 'payment_in_process' | 'partially_paid' | 'paid' | 'cancelled' | 'invalid'
  shippingStatus?: string; // 'pending' | 'handling' | 'ready_to_ship' | 'shipped' | 'delivered' | 'not_delivered' | 'cancelled'
}

export function mapMercadoLivreStatus(raw: MercadoLivreRawOrderStatus): UnifiedOrderStatus {
  const status = raw.status?.toLowerCase();
  const shippingStatus = raw.shippingStatus?.toLowerCase();

  if (status === 'cancelled' || status === 'invalid' || shippingStatus === 'cancelled') {
    return 'CANCELADO';
  }

  if (shippingStatus === 'delivered') {
    return 'ENTREGUE';
  }

  // Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md,
  // seção 2.2) — sinal REAL e já documentado da API do Mercado Livre (ver
  // MercadoLivreRawOrderStatus.shippingStatus acima: 'not_delivered' já
  // constava na lista de valores possíveis antes mesmo de existir
  // NAO_ENTREGUE no UnifiedOrderStatus). Antes, esse sinal ficava preso em
  // ENVIADO — o problema logístico existia mas nunca chegava até o vendedor.
  if (shippingStatus === 'not_delivered') {
    return 'NAO_ENTREGUE';
  }

  if (shippingStatus === 'shipped') {
    return 'ENVIADO';
  }

  const isPaid = status === 'paid' || status === 'partially_paid';
  if (isPaid) {
    // 'handling'/'ready_to_ship' = a preparação já começou de fato, sinal
    // confirmado por MercadoLivreShipmentEnrichmentJob via GET /shipments/{id}.
    // Qualquer outro caso (shippingStatus 'pending' ou ausente) é exatamente
    // o fast path de MercadoLivreOrderProvider.fetchOrders — que NUNCA
    // consulta o shipment inline (ver cabeçalho do arquivo do provider) —
    // ou seja, "pago" é tudo que se sabe com certeza agora. Antes da
    // existência de APROVADO, esse caso caía direto no fallback
    // PREPARANDO_ENVIO, um sinal mais otimista do que o que a API realmente
    // confirmou.
    if (shippingStatus === 'handling' || shippingStatus === 'ready_to_ship') {
      return 'PREPARANDO_ENVIO';
    }
    return 'APROVADO';
  }

  return 'EM_ABERTO';
}
