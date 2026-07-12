import type { OrderStatus } from './api';

// Cor/label por estágio unificado (docs/orders-architecture.md, seção 4) —
// única fonte de verdade para o badge de status na tabela e nas abas do
// dashboard. `dotClass` alimenta o indicador colorido; `badgeClass`, o fundo
// do badge de texto.
export interface OrderStatusMeta {
  label: string;
  badgeClass: string;
  dotClass: string;
}

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  EM_ABERTO: { label: 'Em aberto', badgeClass: 'bg-ink-300/40 text-ink-700', dotClass: 'bg-ink-500' },
  PREPARANDO_ENVIO: { label: 'Preparando envio', badgeClass: 'bg-margin-warning/15 text-margin-warning', dotClass: 'bg-margin-warning' },
  FATURADO: { label: 'Faturado', badgeClass: 'bg-neon/15 text-ink-900', dotClass: 'bg-neon' },
  ENVIADO: { label: 'Enviado', badgeClass: 'bg-blue-500/15 text-blue-700', dotClass: 'bg-blue-500' },
  ENTREGUE: { label: 'Entregue', badgeClass: 'bg-margin-good/15 text-margin-good', dotClass: 'bg-margin-good' },
  CANCELADO: { label: 'Cancelado', badgeClass: 'bg-margin-danger/15 text-margin-danger', dotClass: 'bg-margin-danger' },
};

export const ORDER_STATUS_TABS: OrderStatus[] = [
  'EM_ABERTO',
  'PREPARANDO_ENVIO',
  'FATURADO',
  'ENVIADO',
  'ENTREGUE',
  'CANCELADO',
];
