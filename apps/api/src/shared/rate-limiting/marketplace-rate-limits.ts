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
// demais canais (Shopee, TikTok Shop, Amazon, Magalu, SHEIN) ainda não têm
// client implementado (ver docs/marketplace-intelligence-architecture.md,
// seção 16) — quando existirem, cada um declara seu próprio limite real
// aqui em vez de herdar o DEFAULT_RATE_LIMIT abaixo.
//
// MERCADO_LIVRE foi adicionado explicitamente (24/07/2026) depois de um
// incidente real em produção: a primeira sincronização de pedidos de uma
// conta com histórico de anos (ver janela de backfill em
// order-sync-orchestrator.service.ts) paginou `/orders/search` sem NENHUM
// throttling — MercadoLivreApiClient nunca usou este módulo, apesar dele já
// existir desde a Etapa 17 — e levou um HTTP 429 do Mercado Livre por volta
// da página 42 (offset 2100), derrubando a sincronização inteira (sem
// retry, o erro simplesmente propagava e nenhum pedido era persistido,
// mesmo os já buscados). Sem confirmação do limite oficial documentado,
// mantido deliberadamente no DEFAULT_RATE_LIMIT (1 req/s) — conservador,
// nunca o contrário.
// SHOPEE (27/07/2026) — mesmo aviso de honestidade acima: limite oficial não
// verificado contra documentação ao vivo neste sandbox. Valor idêntico ao
// DEFAULT_RATE_LIMIT (1 req/s) de propósito — declarado explicitamente aqui
// (em vez de deixar cair no fallback) só para documentar que a decisão foi
// consciente, não uma omissão, seguindo a convenção descrita acima.
export const MARKETPLACE_RATE_LIMITS: Record<string, RateLimiterConfig> = {
  NUVEMSHOP: { requestsPerInterval: 2, intervalMs: 1000 },
  SHOPEE: { requestsPerInterval: 1, intervalMs: 1000 },
  // OLIST/Tiny (02/08/2026) — adicionado depois de um incidente real,
  // REPETIÇÃO EXATA do caso do Mercado Livre descrito acima: o
  // OlistApiClient nunca usou este módulo, apesar dele já existir. Fazia
  // `sleep(300)` fixo entre chamadas — 200 req/min — enquanto o plano base
  // do Tiny libera 60 req/min. Resultado em produção, com um catálogo de
  // 340 SKUs: "API Bloqueada - Excedido o número de acessos a API" e ZERO
  // produto importado (sem retry, o erro derrubava o sync inteiro).
  //
  // 09/08/2026 — CORREÇÃO: 1 req/s era exatamente 60 req/min, o teto do plano
  // base. Zero folga. E o comentário acima já dizia o motivo de isso não
  // bastar: "o token é da conta inteira, não só do Kyneti" — o painel do
  // Olist, o app do celular e qualquer outra ferramenta do lojista consomem
  // da MESMA cota. Rodar a 100% do limite garante bloqueio sempre que o
  // seller abre o próprio ERP.
  //
  // Evidência em produção: 135 execuções de sync entre 31/07 e 09/08, todas
  // as recentes falhando com "API Bloqueada", ZERO produto importado. O
  // catálogo do tenant real está vazio.
  //
  // 1 req a cada 1333ms = 45 req/min = 75% do teto, deixando 15 req/min para
  // o resto da conta. Espaçamento estrito (bucket de 1 token) em vez de
  // rajada: o bloqueio do Tiny é por janela de minuto, então o que importa é
  // a taxa média, e uma rajada inicial só antecipa o estouro.
  OLIST: { requestsPerInterval: 1, intervalMs: 1333 },
};

// Fail-safe para qualquer canal sem entrada explícita acima — conservador
// de propósito (1 req/s): mais devagar que o necessário é seguro; mais
// rápido que o limite real do canal é o que suspende a conta do vendedor.
export const DEFAULT_RATE_LIMIT: RateLimiterConfig = { requestsPerInterval: 1, intervalMs: 1000 };

export function getRateLimitConfig(channelCode: string): RateLimiterConfig {
  return MARKETPLACE_RATE_LIMITS[channelCode] ?? DEFAULT_RATE_LIMIT;
}
