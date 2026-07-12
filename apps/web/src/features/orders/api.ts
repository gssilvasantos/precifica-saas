import { apiClient } from '../../lib/api-client';
import type { AppDataMode } from '../app-mode/api';

// Espelha 1:1 apps/api/src/modules/orders/domain/order.entity.ts — mesmo
// racional de duplicação intencional já usado em features/catalog/api.ts
// (o frontend não importa tipo do backend, só replica o formato do JSON).
export type OrderStatus = 'EM_ABERTO' | 'PREPARANDO_ENVIO' | 'FATURADO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO';

export type FiscalResponsibility = 'SELLER' | 'MARKETPLACE';

export interface OrderItem {
  id: string;
  orderId: string;
  skuCode: string | null;
  externalSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount: number | null;
}

export interface Order {
  id: string;
  tenantId: string;
  channelCode: string;
  externalOrderId: string;
  status: OrderStatus;
  externalStatus: string;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  // Normalização financeira (Etapa 17) — netAmount é o valor que de fato
  // interessa para leitura de margem/recebível; totalAmount é o bruto pago
  // pelo comprador. Ver docs/orders-architecture.md, seção 11.2.
  feeAmount: number;
  netAmount: number;
  currency: string;
  fiscalResponsibility: FiscalResponsibility;
  buyerTaxId: string | null;
  invoiceNumber: string | null;
  shippingDeadlineAt: string | null;
  orderedAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface OrderListFilters {
  channelCode?: string;
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  // Modo de Demonstração / Audit Mode — ausente = 'REAL' (mesmo padrão do
  // backend, ver docs/audit-mode.md). Preencha via useAppMode().
  mode?: AppDataMode;
}

export interface OrderListPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export type OrderStatusCounts = Record<OrderStatus, number>;

export async function fetchOrders(
  filters: OrderListFilters,
  page: number,
  pageSize: number,
): Promise<OrderListPage> {
  const { data } = await apiClient.get<OrderListPage>('/orders', {
    params: { ...filters, page, pageSize },
  });
  return data;
}

export async function fetchOrderStatusCounts(mode?: AppDataMode): Promise<OrderStatusCounts> {
  const { data } = await apiClient.get<OrderStatusCounts>('/orders/status-counts', { params: { mode } });
  return data;
}
