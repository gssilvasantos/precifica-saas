import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/logistics-intelligence/application/ports/logistics-settings-repository.port.ts
// — mesmo racional de duplicação intencional do resto do frontend. Fator de
// peso cúbico: divisor usado para converter volume (cm³) em peso cubado
// (kg), usado no cálculo de frete quando o peso cubado supera o real.
export async function fetchCubicWeightFactor(): Promise<number> {
  const { data } = await apiClient.get<{ cubicWeightFactor: number }>('/logistics-intelligence/settings');
  return data.cubicWeightFactor;
}

export async function updateCubicWeightFactor(cubicWeightFactor: number): Promise<number> {
  const { data } = await apiClient.put<{ tenantId: string; cubicWeightFactor: number }>('/logistics-intelligence/settings', { cubicWeightFactor });
  return data.cubicWeightFactor;
}
