import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/catalog/domain/tax-profile.entity.ts +
// interface/dto/{create,update}-tax-profile.dto.ts. CRUD completo já existe
// no backend (ADMIN-only para escrita, leitura aberta a qualquer papel).
export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI' | 'OUTRO';

export const TAX_REGIME_LABEL: Record<TaxRegime, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
  OUTRO: 'Outro',
};

export interface TaxProfile {
  id: string;
  tenantId: string;
  name: string;
  regime: TaxRegime;
  estimatedRatePct: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxProfileInput {
  name: string;
  regime: TaxRegime;
  estimatedRatePct: number;
  notes?: string;
}

export async function fetchTaxProfiles(): Promise<TaxProfile[]> {
  const { data } = await apiClient.get<TaxProfile[]>('/tax-profiles');
  return data;
}

export async function createTaxProfile(input: TaxProfileInput): Promise<TaxProfile> {
  const { data } = await apiClient.post<TaxProfile>('/tax-profiles', input);
  return data;
}

export async function updateTaxProfile(id: string, input: Partial<TaxProfileInput>): Promise<TaxProfile> {
  const { data } = await apiClient.patch<TaxProfile>(`/tax-profiles/${id}`, input);
  return data;
}

export async function deleteTaxProfile(id: string): Promise<void> {
  await apiClient.delete(`/tax-profiles/${id}`);
}
