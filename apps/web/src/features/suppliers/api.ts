import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/catalog/domain/supplier.entity.ts —
// mesmo racional de duplicação intencional do resto do frontend.
export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contact: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name: string;
  contact?: string;
  leadTimeDays?: number;
  paymentTerms?: string;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data } = await apiClient.get<Supplier[]>('/suppliers');
  return data;
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const { data } = await apiClient.post<Supplier>('/suppliers', input);
  return data;
}

export async function updateSupplier(id: string, input: Partial<SupplierInput>): Promise<Supplier> {
  const { data } = await apiClient.patch<Supplier>(`/suppliers/${id}`, input);
  return data;
}

export async function removeSupplier(id: string): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`);
}
