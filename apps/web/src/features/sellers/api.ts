import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/sellers/domain/vendedor.entity.ts e
// shared/contracts/order-commission-writer.port.ts — mesmo racional de
// duplicação intencional do resto do frontend.
export interface Vendedor {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  aliquotaComissaoPct: number;
  descontoMaximoPct: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VendedorInput {
  name: string;
  email?: string;
  aliquotaComissaoPct: number;
  descontoMaximoPct?: number;
}

export interface CommissionLine {
  orderItemId: string;
  orderId: string;
  externalOrderId: string;
  skuCode: string | null;
  productName: string;
  base: number;
  aliquotaPct: number;
  valor: number;
  orderedAt: string;
  comissaoPagaEm: string | null;
}

export interface GeneratePayoutResult {
  accountsPayableId: string;
  amount: number;
  itemCount: number;
}

export async function fetchVendedores(): Promise<Vendedor[]> {
  const { data } = await apiClient.get<Vendedor[]>('/sellers/vendedores');
  return data;
}

export async function createVendedor(input: VendedorInput): Promise<Vendedor> {
  const { data } = await apiClient.post<Vendedor>('/sellers/vendedores', input);
  return data;
}

export async function updateVendedor(id: string, input: Partial<VendedorInput>): Promise<Vendedor> {
  const { data } = await apiClient.patch<Vendedor>(`/sellers/vendedores/${id}`, input);
  return data;
}

export async function setVendedorActive(id: string, isActive: boolean): Promise<Vendedor> {
  const { data } = await apiClient.patch<Vendedor>(`/sellers/vendedores/${id}/active`, { isActive });
  return data;
}

export async function assignVendedorToItem(vendedorId: string, orderId: string, itemId: string): Promise<{ id: string; totalPrice: number }> {
  const { data } = await apiClient.post<{ id: string; totalPrice: number }>(`/sellers/vendedores/${vendedorId}/atribuir-item`, {
    orderId,
    itemId,
  });
  return data;
}

export async function fetchCommissions(vendedorId: string, dateFrom?: string, dateTo?: string): Promise<CommissionLine[]> {
  const { data } = await apiClient.get<CommissionLine[]>(`/sellers/vendedores/${vendedorId}/comissoes`, {
    params: { dateFrom, dateTo },
  });
  return data;
}

export async function generateCommissionPayout(
  vendedorId: string,
  dateFrom: string,
  dateTo: string,
  dueDate: string,
): Promise<GeneratePayoutResult> {
  const { data } = await apiClient.post<GeneratePayoutResult>(`/sellers/vendedores/${vendedorId}/comissoes/gerar-conta-a-pagar`, {
    dateFrom,
    dateTo,
    dueDate,
  });
  return data;
}
