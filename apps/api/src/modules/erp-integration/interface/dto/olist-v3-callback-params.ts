// Parâmetros do redirect do Olist após a autorização (GET, sem JWT).
//
// Por que NÃO é um DTO com class-validator: o provedor (Keycloak) acrescenta
// parâmetros que não controlamos (`session_state`, `iss`, ...) e o
// ValidationPipe global usa `forbidNonWhitelisted`, então um DTO recusava o
// callback inteiro com 400 — foi o que aconteceu na primeira conexão real
// (2026-10-12). A regra global continua intacta; aqui só lemos `code` e `state`
// e ignoramos o resto. O limite de tamanho permanece: é entrada pública.
const MAX_PARAM_LENGTH = 2048;

export interface OlistV3CallbackParams {
  code: string;
  state: string;
}

function readParam(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  return raw.length >= 1 && raw.length <= MAX_PARAM_LENGTH ? raw : null;
}

// Devolve null quando faltar code/state ou estiverem fora do limite (inclusive
// quando o usuário nega a autorização e o provedor manda `error` no lugar do code).
export function readOlistV3CallbackParams(query: Record<string, unknown>): OlistV3CallbackParams | null {
  const code = readParam(query.code);
  const state = readParam(query.state);
  return code && state ? { code, state } : null;
}
