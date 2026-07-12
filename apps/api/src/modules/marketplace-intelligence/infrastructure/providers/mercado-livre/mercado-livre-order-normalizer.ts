import { RawOrderCandidate, RawOrderItemCandidate } from '../../../../../shared/contracts/marketplace-provider.contract';
import { mapMercadoLivreStatus } from './mercado-livre-order-status.mapper';

// Função pura — transforma o payload bruto de `/orders/search` no contrato
// normalizado RawOrderCandidate. Mesmo racional/local de
// NuvemshopOrderProvider.tryNormalize: o adapter (aqui, uma função extraída
// para ficar testável sem instanciar o provider) é o ÚNICO lugar que
// conhece o formato bruto do canal.
//
// AVISO DE HONESTIDADE (Sprint 21): formato assumido com base na
// documentação pública da API de Pedidos do Mercado Livre — nunca validado
// contra uma resposta real (exige OAuth2 de vendedor, ainda não
// implementado). Ver mercado-livre-order.provider.ts.
export function normalizeMercadoLivreOrder(raw: unknown): RawOrderCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const externalOrderId = String(obj.id ?? '');
  if (!externalOrderId) return null;

  const shipping = (obj.shipping ?? {}) as Record<string, unknown>;
  const rawStatus = String(obj.status ?? 'confirmed');
  const shippingStatus = shipping.status ? String(shipping.status) : undefined;
  const unifiedStatus = mapMercadoLivreStatus({ status: rawStatus, shippingStatus });
  const externalStatusParts = [rawStatus, shippingStatus].filter(Boolean);

  const rawItems = Array.isArray(obj.order_items) ? (obj.order_items as Record<string, unknown>[]) : [];
  const items: RawOrderItemCandidate[] = rawItems
    .map((item) => tryNormalizeItem(item))
    .filter((item): item is RawOrderItemCandidate => item !== null);

  const totalAmount = Number(obj.total_amount ?? 0);
  // Comissão do Mercado Livre (sale_fee) — diferente da Nuvemshop, aqui HÁ
  // comissão real de marketplace por venda. Campo assumido por item
  // (order_items[].sale_fee), somado; se ausente (payload não confirmado ao
  // vivo), fica 0 — nunca inventamos uma taxa. Ver aviso de honestidade no
  // topo do arquivo: reconciliar contra um payload real é o primeiro passo
  // ao ativar OAuth2 para este canal.
  const feeAmount = rawItems.reduce((sum, item) => sum + Number(item.sale_fee ?? 0), 0);

  return {
    externalOrderId,
    status: unifiedStatus,
    externalStatus: externalStatusParts.join('/'),
    subtotalAmount: totalAmount,
    shippingAmount: 0, // frete do ML é tipicamente pago pelo comprador via Mercado Envios, fora do total do vendedor — não confirmado ao vivo
    discountAmount: 0,
    totalAmount,
    feeAmount,
    netAmount: totalAmount - feeAmount,
    currency: String(obj.currency_id ?? 'BRL'),
    orderedAt: obj.date_created ? new Date(String(obj.date_created)) : new Date(),
    paidAt: rawStatus.toLowerCase() === 'paid' && obj.date_closed ? new Date(String(obj.date_closed)) : undefined,
    // shippedAt/deliveredAt/cancelledAt: o payload de `/orders/search` não
    // traz a DATA do evento de envio/entrega/cancelamento, só o status atual
    // (`shipping.status`) — precisaria do sub-recurso de shipment
    // (`/shipments/:id`), fora do escopo desta primeira normalização.
    // Deixados ausentes de propósito (nunca fabricamos uma data com
    // `new Date()` só porque o status mudou) — o campo `status`/`externalStatus`
    // já carrega a informação de transição; a data exata fica para uma
    // iteração futura que busque o shipment.
    shippedAt: undefined,
    deliveredAt: undefined,
    cancelledAt: undefined,
    items,
    rawPayload: raw,
  };
}

function tryNormalizeItem(item: Record<string, unknown>): RawOrderItemCandidate | null {
  const itemInfo = (item.item ?? {}) as Record<string, unknown>;
  const externalSku = itemInfo.seller_sku ? String(itemInfo.seller_sku) : itemInfo.id ? String(itemInfo.id) : null;
  if (!externalSku) return null;

  const quantity = Number(item.quantity ?? 1);
  const unitPrice = Number(item.unit_price ?? 0);
  return {
    externalSku,
    productName: String(itemInfo.title ?? ''),
    quantity,
    unitPrice,
    totalPrice: unitPrice * quantity,
  };
}
