import type { Order, OrderItem } from './order.entity';

// Etapa 19 — Orquestração de Custos. Cálculo de margem REAL por pedido,
// separado do conceito de `netAmount` (Etapa 17: valor líquido após
// comissão do canal). Margem aqui é lucro bruto (venda - custo de
// aquisição), um eixo diferente de "quanto o canal descontou" — os dois
// coexistem sem se confundir.
//
// Fallback de integridade de dados (prioridade explícita do pedido): pedidos
// sincronizados ANTES desta etapa (ou itens cujo SKU nunca resolveu) não têm
// `OrderItem.costPrice` (snapshot). Em vez de deixar a margem em branco ou
// assumir zero (o que fabricaria um número), o fallback usa o custo ATUAL do
// produto como a melhor aproximação disponível — e SEMPRE expõe qual fonte
// foi usada (`costSource`), para que quem lê o dado saiba que aquele número
// é uma aproximação, não o custo exato daquele momento da venda.
export type OrderItemCostSource = 'ITEM_SNAPSHOT' | 'CURRENT_PRODUCT' | 'UNKNOWN';

export interface OrderItemMargin {
  orderItemId: string;
  skuCode: string | null;
  costPriceUsed: number | null;
  costSource: OrderItemCostSource;
  marginAmount: number | null;
  marginPct: number | null;
}

export interface OrderMarginSummary {
  orderId: string;
  items: OrderItemMargin[];
  // Quantos itens ficaram sem NENHUM custo conhecido (nem snapshot, nem
  // produto atual — ex.: SKU nunca resolvido contra o catálogo). Excluídos
  // dos totais agregados abaixo, nunca contados como margem zero.
  itemsWithUnknownCost: number;
  totalMarginAmount: number | null;
  totalMarginPct: number | null;
}

// Resolve o custo unitário a usar para UM item — a função central do
// fallback pedido: "se o costPrice do produto for nulo, utilize o custo
// atual do produto como referência". `currentProductCostPrice` é o custo
// EFETIVO atual (produto + embalagem, via ProductCatalogReader), buscado
// pelo chamador (OrdersService) — esta função é pura, não sabe de banco.
export function resolveItemCostPrice(
  item: Pick<OrderItem, 'costPrice'>,
  currentProductCostPrice: number | null,
): { costPriceUsed: number | null; costSource: OrderItemCostSource } {
  if (item.costPrice !== null) {
    return { costPriceUsed: item.costPrice, costSource: 'ITEM_SNAPSHOT' };
  }
  if (currentProductCostPrice !== null) {
    return { costPriceUsed: currentProductCostPrice, costSource: 'CURRENT_PRODUCT' };
  }
  return { costPriceUsed: null, costSource: 'UNKNOWN' };
}

export function computeOrderItemMargin(item: OrderItem, currentProductCostPrice: number | null): OrderItemMargin {
  const { costPriceUsed, costSource } = resolveItemCostPrice(item, currentProductCostPrice);

  if (costPriceUsed === null) {
    return { orderItemId: item.id, skuCode: item.skuCode, costPriceUsed: null, costSource, marginAmount: null, marginPct: null };
  }

  const totalCost = costPriceUsed * item.quantity;
  const marginAmount = item.totalPrice - totalCost;
  const marginPct = item.totalPrice > 0 ? (marginAmount / item.totalPrice) * 100 : null;

  return { orderItemId: item.id, skuCode: item.skuCode, costPriceUsed, costSource, marginAmount, marginPct };
}

// Agrega a margem de todos os itens de um pedido. `currentCostBySku` é um
// mapa (skuCode -> custo efetivo atual) que o chamador monta consultando
// ProductCatalogReader SÓ para os SKUs que realmente precisam do fallback
// (itens sem `costPrice` — ver OrdersService.getMarginSummary), evitando uma
// consulta ao catálogo por item quando o snapshot já resolve o caso comum.
export function computeOrderMarginSummary(order: Order, currentCostBySku: ReadonlyMap<string, number>): OrderMarginSummary {
  const items = order.items.map((item) => {
    const currentCost = item.skuCode ? currentCostBySku.get(item.skuCode) ?? null : null;
    return computeOrderItemMargin(item, currentCost);
  });

  const itemsWithUnknownCost = items.filter((i) => i.costSource === 'UNKNOWN').length;

  const knownIndexes = items.map((i, idx) => (i.marginAmount !== null ? idx : -1)).filter((idx) => idx >= 0);
  const revenueOfKnownItems = knownIndexes.reduce((sum, idx) => sum + order.items[idx].totalPrice, 0);
  const totalMarginAmount =
    knownIndexes.length > 0 ? knownIndexes.reduce((sum, idx) => sum + (items[idx].marginAmount as number), 0) : null;
  const totalMarginPct =
    totalMarginAmount !== null && revenueOfKnownItems > 0 ? (totalMarginAmount / revenueOfKnownItems) * 100 : null;

  return { orderId: order.id, items, itemsWithUnknownCost, totalMarginAmount, totalMarginPct };
}
