import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/.../erp-integration/application/{nuvemshop,olist}-connection.service.ts
// (NuvemshopConnectionStatus / OlistConnectionStatus) — mesmo racional de
// duplicação intencional já usado em features/marketplace-connections/api.ts.
export interface NuvemshopConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface OlistConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
}

// ---------------------------------------------------------------------------
// Nuvemshop — app privado (storeId + access_token estático), sem OAuth2 (ver
// README, Etapa 5 e apps/api/.../nuvemshop-connection.service.ts).
// ---------------------------------------------------------------------------

export async function fetchNuvemshopStatus(): Promise<NuvemshopConnectionStatus> {
  const { data } = await apiClient.get<NuvemshopConnectionStatus>('/erp-integration/nuvemshop/status');
  return data;
}

export async function connectNuvemshop(storeId: string, accessToken: string): Promise<void> {
  await apiClient.post('/erp-integration/nuvemshop/connect', { storeId, accessToken });
}

export async function disconnectNuvemshop(): Promise<void> {
  await apiClient.delete('/erp-integration/nuvemshop/connect');
}

export async function syncNuvemshopNow(): Promise<{ triggered: boolean }> {
  const { data } = await apiClient.post<{ triggered: boolean }>('/erp-integration/nuvemshop/sync-now');
  return data;
}

// ---------------------------------------------------------------------------
// Olist (Tiny) — token estático de API V2, fonte única da verdade do
// catálogo (ver README, Etapa 5). Read-only: o Kyneti só importa, nunca
// escreve de volta no Olist.
// ---------------------------------------------------------------------------

export async function fetchOlistStatus(): Promise<OlistConnectionStatus> {
  const { data } = await apiClient.get<OlistConnectionStatus>('/erp-integration/olist/status');
  return data;
}

export async function connectOlist(apiToken: string): Promise<void> {
  await apiClient.post('/erp-integration/olist/connect', { apiToken });
}

export async function disconnectOlist(): Promise<void> {
  await apiClient.delete('/erp-integration/olist/connect');
}

export async function syncOlistNow(): Promise<{ triggered: boolean }> {
  const { data } = await apiClient.post<{ triggered: boolean }>('/erp-integration/olist/sync-now');
  return data;
}
