import { RawOrderCandidate, RawOrderItemCandidate } from '../../../../../shared/contracts/marketplace-provider.contract';
import { mapShopeeOrderStatus } from './shopee-order-status.mapper';

// Função pura — transforma o payload bruto de `get_order_detail` no contrato
// normalizado RawOrderCandidate. Mesmo racional/local de
// normalizeMercadoLivreOrder: o adapter é o ÚNICO lugar que conhece o
// formato bruto do canal.
//
// AVISO DE HONESTIDADE (ver shopee-api-client.ts, seção de pedidos, e
// shopee-order-status.mapper.ts): campos assumidos da documentação pública
// do Shopee Open Platform v2 — nunca validados contra um pedido real. O
// primeiro sync real de pedidos do usuário é quem confirma ou refuta o
// formato assumido aqui.
//
// feeAmount deliberadamente 0: a comissão real da Shopee (referral fee +
// comission fee) só é exposta pelo endpoint de escrow
// (`/api/v2/payment/get_escrow_detail`), não implementado nesta passada —
// mesmo princípio já seguido em toda a plataforma (nunca inventamos uma
// taxa; 0 é um valor honesto quando a informação não está disponível ainda,
// igual à Nuvemshop antes da Etapa 17). netAmount fica igual a totalAmount
// até esse endpoint ser implementado.
export function normalizeShopeeOrder(raw: unknown): RawOrderCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const externalOrderId = String(obj.order_sn ?? '');
  if (!externalOrderId) return null;

  const rawStatus = String(obj.order_status ?? 'UNPAID');
  const unifiedStatus = mapShopeeOrderStatus(rawStatus);

  const rawItems = Array.isArray(obj.item_list) ? (obj.item_list as Record<string, unknown>[]) : [];
  const items: RawOrderItemCandidate[] = rawItems
    .map((item) => tryNormalizeItem(item))
    .filter((item): item is RawOrderItemCandidate => item !== null);

  const totalAmount = Number(obj.total_amount ?? 0);
  const payTime = obj.pay_time ? Number(obj.pay_time) : undefined;

  return {
    externalOrderId,
    status: unifiedStatus,
    externalStatus: rawStatus,
    subtotalAmount: totalAmount,
    // Frete/desconto não confirmados ao vivo (ver aviso acima) — mesmo
    // tratamento honesto já usado pelo Mercado Livre para shippingAmount.
    shippingAmount: 0,
    discountAmount: 0,
    totalAmount,
    feeAmount: 0,
    netAmount: totalAmount,
    currency: String(obj.currency ?? 'BRL'),
    orderedAt: obj.create_time ? new Date(Number(obj.create_time) * 1000) : new Date(),
    paidAt: payTime ? new Date(payTime * 1000) : undefined,
    // shippedAt/deliveredAt/cancelledAt: get_order_detail não expõe a DATA
    // exata desses eventos nos campos consultados aqui — só o status atual
    // (order_status). Deixados ausentes de propósito, mesmo racional do
    // Mercado Livre: nunca fabricamos uma data com `new Date()` só porque o
    // status mudou.
    shippedAt: undefined,
    deliveredAt: undefined,
    cancelledAt: undefined,
    items,
    rawPayload: raw,
  };
}

function tryNormalizeItem(item: Record<string, unknown>): RawOrderItemCandidate | null {
  // model_sku = SKU no nível de variação (cor/tamanho); item_sku = SKU no
  // nível do produto-pai, usado como fallback quando o item não tem
  // variação. Mesma prioridade documentada pela Shopee para vínculo de SKU.
  const externalSku = item.model_sku ? String(item.model_sku) : item.item_sku ? String(item.item_sku) : null;
  if (!externalSku) return null;

  const quantity = Number(item.model_quantity_purchased ?? 1);
  const unitPrice = Number(item.model_discounted_price ?? item.model_original_price ?? 0);
  return {
    externalSku,
    productName: String(item.item_name ?? ''),
    quantity,
    unitPrice,
    totalPrice: unitPrice * quantity,
  };
}
