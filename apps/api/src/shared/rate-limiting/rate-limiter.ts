// Token bucket genérico — Etapa 17 (escalabilidade multicanal). Cada
// marketplace real (Nuvemshop, Mercado Livre, Shopee, TikTok Shop, Amazon,
// Magalu, SHEIN) documenta seu PRÓPRIO limite de requisições, e violar
// qualquer um deles pode suspender temporariamente a conta do vendedor no
// canal — o pior cenário possível para um sync automático. A resposta
// arquitetural aqui é a mesma disciplina do resto da plataforma: uma peça
// de infraestrutura GENÉRICA e reutilizável (esta classe), configurada
// diferente por canal (ver marketplace-rate-limits.ts) — nunca um "if
// channelCode === X" espalhado pelos clients de API.
//
// Cada API client (NuvemshopApiClient e, no futuro, MercadoLivreApiClient
// etc.) possui SUA PRÓPRIA instância de RateLimiter, injetada/configurada
// com o limite daquele canal — o OrderSyncOrchestrator/RuleSyncOrchestrator
// nunca sabem que rate limiting existe; é uma preocupação 100% do adapter,
// exatamente como a paginação (ver docs/orders-architecture.md, seção 3).
export interface RateLimiterConfig {
  requestsPerInterval: number;
  intervalMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  private tokens: number;
  private lastRefillAt: number;

  constructor(private readonly config: RateLimiterConfig) {
    this.tokens = config.requestsPerInterval;
    this.lastRefillAt = Date.now();
  }

  // Executa `fn` assim que houver um "token" disponível — bloqueia (via
  // await, nunca busy-loop de CPU) até a cota liberar, em vez de rejeitar a
  // chamada. Isso é o comportamento certo para um sync em background (não
  // há um usuário esperando resposta síncrona): mais devagar, nunca 429.
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireToken();
    return fn();
  }

  private async acquireToken(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(this.msUntilNextToken());
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillAt;
    if (elapsedMs <= 0) return;

    const refillRatePerMs = this.config.requestsPerInterval / this.config.intervalMs;
    this.tokens = Math.min(this.config.requestsPerInterval, this.tokens + elapsedMs * refillRatePerMs);
    this.lastRefillAt = now;
  }

  private msUntilNextToken(): number {
    const refillRatePerMs = this.config.requestsPerInterval / this.config.intervalMs;
    const tokensNeeded = 1 - this.tokens;
    return Math.max(1, Math.ceil(tokensNeeded / refillRatePerMs));
  }
}
