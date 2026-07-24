import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/catalog/interface/controllers/catalog-settings.controller.ts
// — dois conceitos de governança deliberadamente separados em duas rotas:
// margens padrão por SKU (sprints antigas) x política financeira global
// (Etapa 13 + targetRoas da Fase 4 de Ads). Leitura aberta a qualquer papel
// (com fallback no backend se o tenant nunca configurou); escrita ADMIN-only.

export interface DefaultMargins {
  desiredMarginPct: number;
  minimumMarginPct: number;
}

export async function fetchDefaultMargins(): Promise<DefaultMargins> {
  const { data } = await apiClient.get<DefaultMargins>('/catalog/settings');
  return data;
}

export async function updateDefaultMargins(input: DefaultMargins): Promise<DefaultMargins> {
  const { data } = await apiClient.put<DefaultMargins>('/catalog/settings', input);
  return data;
}

export interface FinancialPolicy {
  taxRatePct: number;
  minProfitMarginPct: number;
  targetRoas: number | null;
}

export interface UpdateFinancialPolicyInput {
  taxRatePct: number;
  minProfitMarginPct: number;
  targetRoas?: number;
}

export async function fetchFinancialPolicy(): Promise<FinancialPolicy> {
  const { data } = await apiClient.get<FinancialPolicy>('/catalog/settings/financial-policy');
  return data;
}

export async function updateFinancialPolicy(input: UpdateFinancialPolicyInput): Promise<FinancialPolicy> {
  const { data } = await apiClient.put<FinancialPolicy>('/catalog/settings/financial-policy', input);
  return data;
}
