import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/procurement/domain/purchase-order.entity.ts
// — mesmo racional de duplicação intencional do resto do frontend.
export type PurchaseOrderStatus = 'ABERTO' | 'ANDAMENTO' | 'ATENDIDO' | 'CANCELADO';

export interface PurchaseOrderItem {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  skuCode: string;
  quantity: number;
  unitCost: number;
  ipi: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  warehouseId: string;
  paymentDueDate: string;
  notes: string | null;
  invoiceNumber: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderItemInput {
  skuCode: string;
  quantity: number;
  unitCost: number;
  ipi?: number;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  paymentDueDate: string;
  notes?: string;
  items: PurchaseOrderItemInput[];
}

export async function fetchPurchaseOrders(filters?: { status?: PurchaseOrderStatus; supplierId?: string }): Promise<PurchaseOrder[]> {
  const { data } = await apiClient.get<PurchaseOrder[]>('/procurement/purchase-orders', { params: filters });
  return data;
}

export async function fetchPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await apiClient.get<PurchaseOrder>(`/procurement/purchase-orders/${id}`);
  return data;
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
  const { data } = await apiClient.post<PurchaseOrder>('/procurement/purchase-orders', input);
  return data;
}

export async function advancePurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await apiClient.patch<PurchaseOrder>(`/procurement/purchase-orders/${id}/avancar`, {});
  return data;
}

export async function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await apiClient.patch<PurchaseOrder>(`/procurement/purchase-orders/${id}/cancelar`, {});
  return data;
}

export async function receivePurchaseOrder(id: string, invoiceNumber: string): Promise<PurchaseOrder> {
  const { data } = await apiClient.post<PurchaseOrder>(`/procurement/purchase-orders/${id}/receber`, { invoiceNumber });
  return data;
}
