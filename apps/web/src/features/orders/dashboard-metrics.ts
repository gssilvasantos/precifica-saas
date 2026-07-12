import type { Order } from './api';

export interface ChannelPerformance {
  channelCode: string;
  revenue: number; // soma de totalAmount (bruto) do canal
  netAmount: number; // soma de netAmount (líquido) do canal
  marginPct: number | null; // netAmount/revenue — proxy honesto de "ROI por canal" (ver nota abaixo)
  orderCount: number;
}

export interface DashboardMetrics {
  grossRevenue: number;
  netRevenue: number;
  averageMarginPct: number | null;
  activeOrderCount: number;
  channels: ChannelPerformance[];
}

// Cálculo 100% no frontend, a partir dos pedidos já carregados — não existe
// (ainda) um endpoint de analytics agregado no backend (Financial
// Intelligence hoje só expõe CRUD de FixedExpense/ReceivableRecord, ver
// docs/financial-intelligence-architecture.md). Mesma disciplina de
// features/catalog/margin-status.ts: nunca inventar um número, só agregar o
// que os dados normalizados (`Order.totalAmount`/`netAmount`) já garantem.
//
// AVISO DE HONESTIDADE sobre "ROI por canal": ROI de verdade (retorno sobre
// investimento) precisaria do custo do produto (Product.costPrice), que não
// está no pedido — só a comissão do canal está (`feeAmount`). O que este
// cálculo entrega é "% do valor bruto que sobra após a taxa do canal"
// (netAmount/totalAmount), o proxy mais honesto disponível hoje com o dado
// que o hub de pedidos normaliza. Quando o custo de produto por pedido
// existir, essa função é o único lugar que precisa mudar.
export function computeDashboardMetrics(orders: Order[]): DashboardMetrics {
  const active = orders.filter((o) => o.status !== 'CANCELADO');

  const grossRevenue = active.reduce((sum, o) => sum + o.totalAmount, 0);
  const netRevenue = active.reduce((sum, o) => sum + o.netAmount, 0);
  const averageMarginPct = grossRevenue > 0 ? (netRevenue / grossRevenue) * 100 : null;

  const byChannel = new Map<string, { revenue: number; netAmount: number; orderCount: number }>();
  for (const order of active) {
    const entry = byChannel.get(order.channelCode) ?? { revenue: 0, netAmount: 0, orderCount: 0 };
    entry.revenue += order.totalAmount;
    entry.netAmount += order.netAmount;
    entry.orderCount += 1;
    byChannel.set(order.channelCode, entry);
  }

  const channels: ChannelPerformance[] = Array.from(byChannel.entries())
    .map(([channelCode, v]) => ({
      channelCode,
      revenue: v.revenue,
      netAmount: v.netAmount,
      marginPct: v.revenue > 0 ? (v.netAmount / v.revenue) * 100 : null,
      orderCount: v.orderCount,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    grossRevenue,
    netRevenue,
    averageMarginPct,
    activeOrderCount: active.length,
    channels,
  };
}
