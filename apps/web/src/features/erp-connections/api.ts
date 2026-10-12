import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/.../erp-integration/application/{nuvemshop,olist}-connection.service.ts
// (NuvemshopConnectionStatus / OlistConnectionStatus) — mesmo racional de
// duplicação intencional já usado em features/marketplace-connections/api.ts.
export interface NuvemshopConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

// PARTIAL = sincronizou e importou, mas parte do catálogo ficou de fora
// (cadastro incompleto no Olist, ou produto que a API não devolveu). Nem
// SUCCESS nem FAILED contam a verdade nesse caso — ver o comentário em
// OlistConnectionRepository.markSyncedWithWarning, no backend.
//
// O tipo era `string | null`, o que deixou a UI ignorar PARTIAL em silêncio
// por não haver nada que apontasse o caso faltante.
export type OlistSyncStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL';

export interface OlistConnectionStatus {
  connected: boolean;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: OlistSyncStatus | null;
  lastSyncError: string | null;
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

// ---------------------------------------------------------------------------
// Olist API v3 (OAuth2) — ADR 0003, fatia 1: conexão + verificação somente de
// leitura. Espelha à mão apps/api/.../olist-v3-connection.service.ts
// (OlistV3ConnectionStatus) e olist-v3-verification.service.ts. Contrato em
// docs/api/olist-v3-connection.md. Dívida conhecida: tipos duplicados.
// ---------------------------------------------------------------------------

export interface OlistV3Status {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  connectedAt: string | null;
}

export interface OlistV3ProductSummary {
  id: string | null;
  sku: string | null;
  tipo: string | null;
  tipoVariacao: string | null;
  campos: {
    precoCusto: number | null;
    preco: number | null;
    estoqueQuantidade: number | null;
    pesoLiquido: number | null;
    pesoBruto: number | null;
    largura: number | null;
    altura: number | null;
    comprimento: number | null;
    ncm: string | null;
    gtin: string | null;
    origem: string | null;
    categoria: string | null;
  };
  fotos: number;
  variacoes: { total: number; chavesDaPrimeira: string[] };
  ausentes: string[];
}

export interface OlistV3RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetSeconds: number | null;
}

export interface OlistV3SkuVerification {
  sku: string;
  found: boolean;
  tipoVariacao: string | null;
  produto: OlistV3ProductSummary | null;
  error: string | null;
}

export interface OlistV3VerifyResult {
  checkedAt: string;
  rateLimit: OlistV3RateLimitInfo | null;
  incrementalProbe: {
    windowDays: number;
    since: string;
    totalChanged: number | null;
    returned: number;
    error: string | null;
  };
  skus: OlistV3SkuVerification[];
  callsMade: number;
}

export async function fetchOlistV3Status(): Promise<OlistV3Status> {
  const { data } = await apiClient.get<OlistV3Status>('/erp-integration/olist/v3/status');
  return data;
}

export async function fetchOlistV3AuthorizeUrl(): Promise<{ authorizeUrl: string }> {
  const { data } = await apiClient.get<{ authorizeUrl: string }>('/erp-integration/olist/v3/authorize');
  return data;
}

export async function disconnectOlistV3(): Promise<void> {
  await apiClient.delete('/erp-integration/olist/v3/connect');
}

export async function verifyOlistV3(skus: string[]): Promise<OlistV3VerifyResult> {
  const { data } = await apiClient.post<OlistV3VerifyResult>('/erp-integration/olist/v3/verify', { skus });
  return data;
}
