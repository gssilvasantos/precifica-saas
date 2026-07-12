// Utilitário genérico de retry com backoff exponencial — Sprint 27, Item 3
// da fila de validação em produção ("análise de gargalo"). Motivado por um
// gap real encontrado no upload de chunks de vídeo (ver
// ConferenciaDetalhePage.tsx): sob perda de pacote/rede instável (exatamente
// o cenário de 20 operadores disputando a mesma rede da doca), uma falha
// isolada de upload nunca era reenviada — o número de sequência do chunk já
// tinha avançado no cliente, então todo chunk seguinte era rejeitado pelo
// servidor como "fora de ordem" (canAcceptChunk), corrompendo silenciosamente
// o resto da gravação. Um retry curto aqui resolve a maioria das falhas
// transitórias de rede antes que isso aconteça.
export interface RetryOptions {
  retries?: number; // tentativas ADICIONAIS após a primeira (default 3)
  baseDelayMs?: number; // atraso da 1ª retentativa; dobra a cada tentativa
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break; // última tentativa já falhou — não espera mais, propaga
      const delay = baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
