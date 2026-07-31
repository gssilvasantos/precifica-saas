import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/production/domain/production-order.entity.ts
// — mesmo racional de duplicação intencional do resto do frontend.
export type ProductionOrderStatus = 'RASCUNHO' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

export interface ProductionOrderComponent {
  id: string;
  tenantId: string;
  productionOrderId: string;
  componentSkuCode: string;
  quantityPerUnit: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionOrder {
  id: string;
  tenantId: string;
  status: ProductionOrderStatus;
  parentSkuCode: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes: string | null;
  concludedAt: string | null;
  createdAt: string;
  updatedAt: string;
  components: ProductionOrderComponent[];
}

export interface CreateProductionOrderInput {
  parentSkuCode: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes?: string;
}

export async function fetchProductionOrders(status?: ProductionOrderStatus): Promise<ProductionOrder[]> {
  const { data } = await apiClient.get<ProductionOrder[]>('/production/orders', { params: status ? { status } : undefined });
  return data;
}

export async function createProductionOrder(input: CreateProductionOrderInput): Promise<ProductionOrder> {
  const { data } = await apiClient.post<ProductionOrder>('/production/orders', input);
  return data;
}

export async function startProductionOrder(id: string): Promise<ProductionOrder> {
  const { data } = await apiClient.patch<ProductionOrder>(`/production/orders/${id}/iniciar`, {});
  return data;
}

export async function concludeProductionOrder(id: string): Promise<ProductionOrder> {
  const { data } = await apiClient.patch<ProductionOrder>(`/production/orders/${id}/concluir`, {});
  return data;
}

export async function cancelProductionOrder(id: string): Promise<ProductionOrder> {
  const { data } = await apiClient.patch<ProductionOrder>(`/production/orders/${id}/cancelar`, {});
  return data;
}
