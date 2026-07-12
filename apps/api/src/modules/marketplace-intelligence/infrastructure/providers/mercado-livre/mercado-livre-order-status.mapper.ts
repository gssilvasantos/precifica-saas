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

  if (shippingStatus === 'shipped') {
    return 'ENVIADO';
  }

  const isPaid = status === 'paid' || status === 'partially_paid';
  if (isPaid) {
    return 'PREPARANDO_ENVIO';
  }

  return 'EM_ABERTO';
}
