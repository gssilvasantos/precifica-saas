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
