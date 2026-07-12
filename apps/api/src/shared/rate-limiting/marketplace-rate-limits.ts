import { RateLimiterConfig } from './rate-limiter';

// Limites POR CANAL — adicionar um marketplace novo é acrescentar uma
// entrada aqui, nunca alterar RateLimiter nem o client que o consome.
//
// AVISO DE HONESTIDADE: não tenho confiança para afirmar os limites oficiais
// exatos de cada uma dessas APIs neste ambiente (não consigo validar a
// documentação ao vivo). O valor abaixo para NUVEMSHOP é uma aproximação
// conservadora baseada no padrão comum de APIs de e-commerce
// (poucas requisições por segundo por loja) — DEVE ser confirmado contra a
// documentação oficial antes de operar em produção com volume real. Os
// demais canais (Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu, SHEIN)
// ainda não têm client implementado (ver docs/marketplace-intelligence-architecture.md,
// seção 16) — quando existirem, cada um declara seu próprio limite real
// aqui em vez de herdar o DEFAULT_RATE_LIMIT abaixo.
export const MARKETPLACE_RATE_LIMITS: Record<string, RateLimiterConfig> = {
  NUVEMSHOP: { requestsPerInterval: 2, intervalMs: 1000 },
};

// Fail-safe para qualquer canal sem entrada explícita acima — conservador
// de propósito (1 req/s): mais devagar que o necessário é seguro; mais
// rápido que o limite real do canal é o que suspende a conta do vendedor.
export const DEFAULT_RATE_LIMIT: RateLimiterConfig = { requestsPerInterval: 1, intervalMs: 1000 };

export function getRateLimitConfig(channelCode: string): RateLimiterConfig {
  return MARKETPLACE_RATE_LIMITS[channelCode] ?? DEFAULT_RATE_LIMIT;
}
