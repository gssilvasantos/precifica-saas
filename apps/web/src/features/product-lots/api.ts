import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/catalog/domain/product-lot.ts (cadastro)
// e apps/api/src/modules/logistics-fulfillment/application/lot-availability.service.ts
// (saldo/FEFO) — mesmo racional de duplicação intencional do resto do
// frontend. Cadastro de lote mora no Catalog (por produto); movimentação de
// estoque por lote mora no Logistics Fulfillment (por depósito+SKU) — dois
// módulos de backend diferentes, uma única tela no frontend.

export type ProductLotStatus = 'ATIVO' | 'INATIVO';

export interface ProductLot {
  id: string;
  tenantId: string;
  skuCode: string;
  lotCode: string;
  dataFabricacao: string | null;
  dataValidade: string;
  diasPermitidoVenda: number;
  codigoAgregacao: string | null;
  status: ProductLotStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductLotInput {
  lotCode: string;
  dataFabricacao?: string;
  dataValidade: string;
  diasPermitidoVenda?: number;
  codigoAgregacao?: string;
}

export async function fetchProductLots(productId: string): Promise<ProductLot[]> {
  const { data } = await apiClient.get<ProductLot[]>(`/products/${productId}/lots`);
  return data;
}

export async function createProductLot(productId: string, input: CreateProductLotInput): Promise<ProductLot> {
  const { data } = await apiClient.post<ProductLot>(`/products/${productId}/lots`, input);
  return data;
}

export async function setProductLotStatus(productId: string, lotCode: string, status: ProductLotStatus): Promise<ProductLot> {
  const { data } = await apiClient.patch<ProductLot>(`/products/${productId}/lots/${lotCode}/status`, { status });
  return data;
}

// --- Movimentação de estoque por lote (logistics-fulfillment/lot-stock) ---

export type LotAdjustmentMovementType = 'ENTRADA' | 'SAIDA' | 'BALANCO';

export interface AdjustLotInput {
  warehouseId: string;
  skuCode: string;
  lotCode: string;
  movementType: LotAdjustmentMovementType;
  quantity: number;
  notes: string;
}

export interface LotBalanceLine {
  lotCode: string;
  balance: number;
  dataValidade: string;
  diasPermitidoVenda: number;
  status: ProductLotStatus;
}

export interface LotAllocation {
  lotCode: string;
  quantity: number;
}

export interface FefoSelectionResult {
  allocations: LotAllocation[];
  fullyAllocated: boolean;
  shortfall: number;
}

export async function adjustLotStock(input: AdjustLotInput): Promise<{ auditEventId: string }> {
  const { data } = await apiClient.post<{ auditEventId: string }>('/logistics-fulfillment/lot-stock/adjustments', input);
  return data;
}

export async function fetchLotBalances(warehouseId: string, skuCode: string): Promise<LotBalanceLine[]> {
  const { data } = await apiClient.get<LotBalanceLine[]>(
    `/logistics-fulfillment/lot-stock/warehouses/${warehouseId}/skus/${skuCode}/balances`,
  );
  return data;
}

export async function fetchFefoSuggestion(warehouseId: string, skuCode: string, quantity: number): Promise<FefoSelectionResult> {
  const { data } = await apiClient.get<FefoSelectionResult>(
    `/logistics-fulfillment/lot-stock/warehouses/${warehouseId}/skus/${skuCode}/fefo-suggestion`,
    { params: { quantity } },
  );
  return data;
}
