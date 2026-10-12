# Sync do Olist pela API v3 — falhas e retomada

**Quando isto acontece:** card do Olist em Integrações com status `PARTIAL`/`FAILED`; alerta de
falha de renovação de token v3; log `Sync Olist v3 ... falhou`.
**Impacto:** catálogo (custo, dimensões, estoque) deixa de atualizar. Preço e pedidos não param.

**Confirmar**
1. Integrações → card Olist: mensagem de aviso/erro e data da última sincronização.
2. Logs do serviço no Render: filtrar por `Olist v3`.
3. Banco (leitura): `SELECT "lastSyncStatus","lastSyncedAt","v3SyncCursorAt","v3ConnectedAt" FROM erp_integration.olist_connections;`

**Resolver**
- *Token expirado / invalid_grant:* Integrações → Olist → Conectar API v3 (refresh vale 24 h; o
  keep-alive do agendador evita, mas não renova se a API ficou dormindo >24 h).
- *Limite de requisições (HTTP 429):* nada a fazer; a rodada para e retoma na seguinte. Se persistir,
  verificar se outra integração (rm-catalogo, MCP) está consumindo a mesma cota.
- *Produtos "ficaram para a próxima rodada":* normal no primeiro sync (teto de 120 por rodada).
- *Cadastro inválido (sem sku/nome):* corrigir no Olist; não bloqueia o cursor.
- *Reverter para v2:* `OLIST_V3_SYNC_ENABLED=false` no Render e redeploy/restart. Dados e cursor permanecem.
- *Reprocessar tudo:* `UPDATE erp_integration.olist_connections SET "v3SyncCursorAt" = NULL WHERE "tenantId" = '<id>';`
  (a próxima rodada usa janela de 7 dias; produtos nunca importados entram de qualquer forma).
  Passo que muda estado: confirmar antes.

**Verificar:** próxima rodada termina com `SUCCESS` e o card volta a "sincronizado".
**Escalar:** `PARTIAL` repetido por mais de 24 h sem 429 nem cadastro inválido apontado.
