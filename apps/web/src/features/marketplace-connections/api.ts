import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/marketplace-intelligence/application/
// mercado-livre-connection.service.ts (MercadoLivreConnectionStatus) — mesmo
// racional de duplicação intencional do resto do frontend (datas como
// string, o JSON nunca chega como Date de verdade).
export interface MercadoLivreConnectionStatus {
  connected: boolean;
  isActive: boolean;
  sellerId: string | null;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
}

// Espelha apps/api/.../mercado-livre-handshake.service.ts (MercadoLivreHandshakeResult).
export interface MercadoLivreHandshakeResult {
  success: boolean;
  testedAt: string;
  sellerId: string | null;
  tokenRefreshed: boolean;
  ordersFound: number;
  sampleOrderId: string | null;
  errorMessage: string | null;
}

export async function fetchMercadoLivreStatus(): Promise<MercadoLivreConnectionStatus> {
  const { data } = await apiClient.get<MercadoLivreConnectionStatus>('/marketplace-intelligence/mercado-livre/status');
  return data;
}

// Passo 1 do OAuth2 — devolve a URL de autorização do próprio Mercado Livre;
// quem chama isto deve redirecionar o navegador inteiro para lá
// (window.location.href), nunca abrir via fetch/XHR (é uma tela de login,
// não uma resposta JSON para consumir).
export async function fetchMercadoLivreAuthorizeUrl(): Promise<{ authorizeUrl: string }> {
  const { data } = await apiClient.get<{ authorizeUrl: string }>('/marketplace-intelligence/mercado-livre/authorize');
  return data;
}

export async function disconnectMercadoLivre(): Promise<void> {
  await apiClient.delete('/marketplace-intelligence/mercado-livre/connect');
}

// Fase de Conexão Real — diagnóstico read-only (status -> renovação ->
// fetchOrders real), nunca grava pedido. Ver
// mercado-livre-handshake.service.ts no backend para o racional completo.
export async function testMercadoLivreConnection(): Promise<MercadoLivreHandshakeResult> {
  const { data } = await apiClient.post<MercadoLivreHandshakeResult>('/marketplace-intelligence/mercado-livre/test-connection');
  return data;
}

// Integração Shopee (27/07/2026) — espelha
// apps/api/.../shopee-connection.service.ts (ShopeeConnectionStatus).
export interface ShopeeConnectionStatus {
  connected: boolean;
  isActive: boolean;
  shopId: string | null;
  expiresAt: string | null;
  lastRefreshedAt: string | null;
}

// Espelha apps/api/.../shopee-handshake.service.ts (ShopeeHandshakeResult).
export interface ShopeeHandshakeResult {
  success: boolean;
  testedAt: string;
  shopId: string | null;
  tokenRefreshed: boolean;
  shopName: string | null;
  shopStatus: string | null;
  errorMessage: string | null;
}

export async function fetchShopeeStatus(): Promise<ShopeeConnectionStatus> {
  const { data } = await apiClient.get<ShopeeConnectionStatus>('/marketplace-intelligence/shopee/status');
  return data;
}

// Passo 1 do fluxo Shopee — devolve a URL de autorização da própria Shopee;
// mesmo racional de fetchMercadoLivreAuthorizeUrl: redirecionar o navegador
// inteiro (window.location.href), nunca consumir via fetch/XHR.
export async function fetchShopeeAuthorizeUrl(): Promise<{ authorizeUrl: string }> {
  const { data } = await apiClient.get<{ authorizeUrl: string }>('/marketplace-intelligence/shopee/authorize');
  return data;
}

export async function disconnectShopee(): Promise<void> {
  await apiClient.delete('/marketplace-intelligence/shopee/connect');
}

// Diagnóstico read-only (status -> renovação -> GET /shop/get_shop_info
// real), nunca grava pedido/produto. Ver shopee-handshake.service.ts no
// backend para o racional completo.
export async function testShopeeConnection(): Promise<ShopeeHandshakeResult> {
  const { data } = await apiClient.post<ShopeeHandshakeResult>('/marketplace-intelligence/shopee/test-connection');
  return data;
}
