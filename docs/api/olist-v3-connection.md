# API — Conexão e verificação do Olist v3

Módulo: `erp-integration` · Controller: `olist-v3-connection.controller.ts` · ADR: `docs/decisions/0003-olist-api-v3-sync-incremental.md`
Data: 2026-10-12 · Prefixo: `/api/erp-integration/olist/v3`

Fatia 1 de 3. **Não altera o sync v2.** Tudo atrás da flag `OLIST_V3_ENABLED` (desligada por padrão).
Autorização em todas as rotas autenticadas: `JwtAuthGuard` → `RolesGuard` → `ModuleAccessGuard`
(`INTEGRATIONS`); o tenant vem sempre do token, nunca do corpo ou da query.

## Erros comuns (código estável em `message.code`)

| HTTP | Código | Quando |
|---|---|---|
| 503 | `OLIST_V3_DISABLED` | `OLIST_V3_ENABLED` diferente de `true` |
| 503 | `OLIST_V3_NOT_CONFIGURED` | falta `OLIST_V3_CLIENT_ID`, `OLIST_V3_CLIENT_SECRET` ou `OLIST_V3_REDIRECT_URI` |
| 404 | `OLIST_V3_NOT_CONNECTED` | tenant sem token v3 |
| 401 | `OLIST_V3_RECONNECT_REQUIRED` | refresh token vencido/inválido — reconectar |
| 400 | `OLIST_V2_CONNECTION_REQUIRED` | (callback) tenant sem conexão v2 (a linha de `olist_connections` é compartilhada) |

## GET `/status`
Qualquer papel com módulo `INTEGRATIONS`. Resposta:
`{ enabled, configured, connected, accessExpiresAt, refreshExpiresAt, connectedAt }` (datas ISO ou `null`). Nunca devolve token. Com a flag desligada responde 200 com `enabled:false` (é o que a UI usa para esconder o painel).

## GET `/authorize`
`ADMIN`. Resposta `{ authorizeUrl }`; o cliente redireciona o navegador. `state` criptografado
(`tenantId` + emissão), validade de 10 min.

## GET `/callback`  *(público de propósito)*
Sem JWT: quem chama é o navegador redirecionado pelo Olist. Proteção: `state` criptografado e
com validade; `code`/`state` lidos à mão (máx. 2048; parâmetros extras do provedor, como `session_state`, são ignorados — um DTO os recusaria com 400). Sempre responde 302 para
`${FRONTEND_BASE_URL}/integracoes?conectado=olist-v3` ou `?erro=olist-v3`. Grava os tokens
criptografados (AES-256-GCM) dentro do contexto do tenant do `state`.

## DELETE `/connect`
`ADMIN`. Apaga só os tokens v3 (a conexão v2 permanece). Idempotente.

## POST `/verify`
`ADMIN`. **Somente leitura**, mas gasta cota do Olist (conta inteira): no máximo 7 chamadas
(1 sonda `dataAlteracao` dos últimos 7 dias + 2 por SKU). Entrada `{ skus: string[1..3] }`
(cada SKU até 60 caracteres, `[A-Za-z0-9._-/ ]`). Saída: `rateLimit`, `incrementalProbe`,
`skus[]` (com `found`, `tipoVariacao`, resumo de campos presentes e `ausentes`) e `callsMade`.
Nunca devolve URL de foto nem texto livre.

Idempotência: não escreve nada. Rate limiting: cliente com `RateLimiter('OLIST_V3')` (1 req/1,33 s,
valor **não verificado** contra o limite oficial) e leitura de `x-ratelimit-*`.

## Dívida conhecida — tipos duplicados
Os tipos do cliente estão copiados à mão em `apps/web/src/features/erp-connections/api.ts`
(`OlistV3Status`, `OlistV3VerifyResult`). Mudou o DTO ou a resposta, atualize os dois no mesmo commit.

## Sync pela v3 (fatia 2)
Sem rota nova. `POST /erp-integration/olist/sync-now` e o agendador passam a usar
`OlistV3SyncService` quando `OLIST_V3_ENABLED` e `OLIST_V3_SYNC_ENABLED` são `true`; caso contrário,
o sync v2. Resposta e permissões inalteradas. Ver ADR 0003 e `docs/runbooks/olist-v3-sync.md`.

## Não exercitado
A fatia 1 foi verificada contra a conta real (RM0100, RM0024-5). O sync da fatia 2 só tem testes
com fakes; a primeira rodada real ainda não foi executada.
