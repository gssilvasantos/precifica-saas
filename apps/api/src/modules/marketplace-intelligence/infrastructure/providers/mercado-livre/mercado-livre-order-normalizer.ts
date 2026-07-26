import { RawOrderCandidate, RawOrderItemCandidate } from '../../../../../shared/contracts/marketplace-provider.contract';
import { mapMercadoLivreStatus } from './mercado-livre-order-status.mapper';

// Função pura — transforma o payload bruto de `/orders/search` no contrato
// normalizado RawOrderCandidate. Mesmo racional/local de
// NuvemshopOrderProvider.tryNormalize: o adapter (aqui, uma função extraída
// para ficar testável sem instanciar o provider) é o ÚNICO lugar que
// conhece o formato bruto do canal.
//
// AVISO DE HONESTIDADE (Sprint 21) — ATUALIZADO em 24/07/2026 após o
// primeiro sync real: a suposição original de que `shipping.status` viria
// preenchido dentro do payload de `/orders/search` estava ERRADA — aquele
// campo é só uma referência (`{id: <shipment_id>}`), nunca o status de
// fato. O status real de envio só existe no sub-recurso dedicado
// (`GET /shipments/{id}`, ver MercadoLivreApiClient.fetchShipmentStatus) —
// por isso esta função agora aceita `resolvedShippingStatus` como segundo
// parâmetro, resolvido pelo PROVIDER (que tem acesso ao client/token, algo
// que esta função pura não tem) antes de chamar normalizeMercadoLivreOrder.
// Sem ele, cai no fallback de `shipping.status` só por retrocompatibilidade
// — na prática, quase sempre undefined em produção.
export function normalizeMercadoLivreOrder(raw: unknown, resolvedShippingStatus?: string): RawOrderCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const externalOrderId = String(obj.id ?? '');
  if (!externalOrderId) return null;

  const shipping = (obj.shipping ?? {}) as Record<string, unknown>;
  const rawStatus = String(obj.status ?? 'confirmed');
  const shippingStatus = resolvedShippingStatus ?? (shipping.status ? String(shipping.status) : undefined);
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

// Extrai o `shipping.id` (referência ao envio) do payload bruto — usado
// pelo PROVIDER para decidir se vale a pena consultar
// MercadoLivreApiClient.fetchShipmentStatus antes de normalizar (só faz
// sentido para pedidos pagos, ver comentário em mercado-livre-order.provider.ts).
// Extraído como função própria (em vez de expor via RawOrderCandidate) para
// não vazar um campo específico do Mercado Livre no contrato compartilhado
// entre canais (marketplace-provider.contract.ts).
export function extractShippingId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const shipping = ((raw as Record<string, unknown>).shipping ?? {}) as Record<string, unknown>;
  return shipping.id != null ? String(shipping.id) : null;
}

// Status bruto de ORDEM (não de envio) — usado pelo provider para decidir
// se um pedido está "pago" o suficiente para valer a pena consultar o envio
// real (pedido em aberto/cancelado não tem shipping relevante ainda).
export function extractOrderStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'confirmed';
  return String((raw as Record<string, unknown>).status ?? 'confirmed').toLowerCase();
}

// Data de criação do pedido — usada pelo PROVIDER (25/07/2026) para decidir
// se vale a pena consultar o status real de envio (ver
// SHIPMENT_ENRICHMENT_WINDOW_MS em mercado-livre-order.provider.ts). Achado
// real de produção: uma conta com volume alto (~4.500 pedidos criados nos
// últimos 90 dias) tornaria o enriquecimento pedido-a-pedido inviável
// (1h+ só nessa fase, a 1 req/s) se aplicado a TODO pedido pago da janela de
// backfill. Pedido pago há muitas semanas quase certamente já foi
// enviado/entregue — não vale gastar uma chamada de API nele toda vez que o
// backfill roda; só pedidos pagos RECENTES (ainda plausivelmente em
// trânsito) valem a consulta extra.
export function extractOrderCreatedAt(raw: unknown): Date | null {
  if (!raw || typeof raw !== 'object') return null;
  const dateCreated = (raw as Record<string, unknown>).date_created;
  if (!dateCreated) return null;
  const parsed = new Date(String(dateCreated));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
