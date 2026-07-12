// Retry genérico com backoff — extraído para shared/ na Etapa 17 porque
// passa a ser usado pelo RateLimiter/API clients de vários canais, não só
// por um orquestrador. RuleSyncOrchestrator/ErpSyncOrchestrator têm cada um
// sua própria cópia privada deste mesmo padrão (histórico, pré-Etapa 17);
// não foram migrados nesta fatia para não misturar um refactor não pedido
// com o escopo desta resposta — mas qualquer novo client de marketplace
// (Mercado Livre, Shopee...) deve usar ESTA versão compartilhada.
export interface RetryOptions {
  maxAttempts?: number;
  backoffMs?: number[];
  // Permite não retentar erros que nunca vão se resolver sozinhos (ex.: 401
  // de credencial inválida) — default retenta qualquer erro.
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = [2000, 8000, 32000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
    }
  }
  throw lastError;
}

// Predicado pronto para o caso mais comum de rate limiting: HTTP 429. Os
// clients baseados em `fetch` (todos, nesta plataforma — ver aviso de
// honestidade em nuvemshop-api.client.ts) lançam um Error com essa
// convenção de mensagem (`HTTP 429`); este helper casa com ela sem acoplar
// o retry a um client específico.
export function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /HTTP 429/.test(error.message);
}
