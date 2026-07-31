import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/catalog/domain/packaging.entity.ts —
// mesmo racional de duplicação intencional do resto do frontend.
export type PackagingPurpose = 'STANDARD' | 'GROUPING' | 'MASTER' | 'SAFETY_DEFAULT';

export const PACKAGING_PURPOSE_LABEL: Record<PackagingPurpose, string> = {
  STANDARD: 'Padrão (1 SKU)',
  GROUPING: 'Agrupamento (kit/combo)',
  MASTER: 'Caixa mestre',
  SAFETY_DEFAULT: 'Fallback padrão',
};

export interface Packaging {
  id: string;
  tenantId: string;
  name: string;
  weightG: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  costPrice: number;
  stockQuantity: number;
  isActive: boolean;
  purpose: PackagingPurpose;
  maxCapacityKg: number | null;
  createdAt: string;
  updatedAt: string;
}

// purpose/maxCapacityKg não são setáveis via API ainda (Sprint 26 — ver
// CreatePackagingDto/UpdatePackagingDto no backend) — toda embalagem criada
// por esta tela nasce STANDARD, mesmo comportamento do backend.
export interface PackagingInput {
  name: string;
  weightG: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  costPrice: number;
  stockQuantity?: number;
}

export async function fetchPackagings(): Promise<Packaging[]> {
  const { data } = await apiClient.get<Packaging[]>('/packagings');
  return data;
}

export async function createPackaging(input: PackagingInput): Promise<Packaging> {
  const { data } = await apiClient.post<Packaging>('/packagings', input);
  return data;
}

export async function updatePackaging(id: string, input: Partial<PackagingInput>): Promise<Packaging> {
  const { data } = await apiClient.patch<Packaging>(`/packagings/${id}`, input);
  return data;
}

export async function removePackaging(id: string): Promise<void> {
  await apiClient.delete(`/packagings/${id}`);
}
