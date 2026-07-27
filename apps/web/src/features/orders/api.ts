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

// channelCode ausente = contagem de TODOS os canais (bug de produção
// 26/07/2026: as abas de status ignoravam o canal selecionado no dropdown,
// mostrando contagem global mesmo com um canal específico escolhido).
export async function fetchOrderStatusCounts(mode?: AppDataMode, channelCode?: string): Promise<OrderStatusCounts> {
  const { data } = await apiClient.get<OrderStatusCounts>('/orders/status-counts', { params: { mode, channelCode } });
  return data;
}

export interface TriggerOrderSyncResult {
  triggered: boolean;
  providerCode: string;
}

// "Sincronizar agora" (24/07/2026) — dispara o MESMO pipeline do cron de 10
// min (orders-sync-scheduler.job.ts), só que sob demanda. AVISO: o endpoint
// (`OrdersSyncController.triggerSync`) espera a sincronização terminar antes
// de responder — para um canal com muito histórico e rate limit
// conservador (ver mercado-livre-api.client.ts), isso pode levar minutos, não
// segundos. O botão que chama isto precisa deixar isso claro (nunca parecer
// travado).
export async function triggerOrderSync(providerCode: string): Promise<TriggerOrderSyncResult> {
  const { data } = await apiClient.post<TriggerOrderSyncResult>(`/orders/providers/${providerCode}/sync`);
  return data;
}
