-- ============================================================================
-- Row-Level Security (RLS) — habilitação + policies de isolamento por tenant
-- ============================================================================
-- Ver docs/row-level-security-architecture.md para o desenho completo e o
-- racional de cada decisão abaixo. Resumo do que este arquivo faz:
--
--   1. ENABLE + FORCE ROW LEVEL SECURITY em toda tabela de dado de cliente
--      (~30 tabelas, ver inventário na seção 4 do doc). FORCE é obrigatório
--      aqui, não opcional: sem ele, o role dono das tabelas (o mesmo usado
--      em DATABASE_URL/DIRECT_URL) simplesmente ignora as policies e a
--      "proteção" não protegeria nada — ver seção 3.4 do doc.
--   2. Uma policy `tenant_isolation` por tabela, comparando a coluna
--      "tenantId" contra `current_setting('app.current_tenant_id', true)`
--      — variável de sessão que a aplicação seta via
--      `set_config('app.current_tenant_id', $1, true)` dentro da MESMA
--      transação de cada query (ver shared/prisma/prisma.service.ts).
--   3. Uma válvula de bypass explícita (`app.bypass_rls = 'on'`) para os
--      poucos pontos legítimos de acesso cross-tenant (schedulers na fase de
--      descoberta de "quais tenants processar" — ver TenantContextStore).
--   4. USING **e** WITH CHECK em toda policy — o exemplo original do
--      desenho (seção 4 do doc) só tinha USING, o que bloquearia leitura de
--      linha de outro tenant mas NÃO impediria uma query mal-formada de
--      INSERIR/ATUALIZAR uma linha marcando-a com o tenantId ERRADO. Com
--      WITH CHECK, essa gravação também é rejeitada pelo Postgres.
--
-- ESTE ARQUIVO NÃO FICA NA PASTA `prisma/migrations/` DE PROPÓSITO. Aquela
-- pasta é lida automaticamente por `prisma migrate deploy` (inclusive num
-- possível Pre-Deploy Command futuro do Render) — colocar esta migração lá
-- faria com que ela fosse aplicada em produção na primeira vez que alguém
-- rodasse `migrate deploy` por qualquer outro motivo, sem o teste manual em
-- staging que a seção 6 do doc exige. Aplicação é manual e deliberada:
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-17_enable_row_level_security.sql
--
-- (usa DIRECT_URL — porta 5432 — nunca a DATABASE_URL pooled; DDL de RLS
-- precisa de conexão de sessão, mesma razão de `prisma migrate` já usar
-- DIRECT_URL hoje.)
--
-- CHECKLIST ANTES DE RODAR EM QUALQUER AMBIENTE (ver seção 6 do doc):
--   [ ] Rodando contra Supabase de STAGING, não produção.
--   [ ] Backup/snapshot do banco de staging tirado antes.
--   [ ] Script de rollback (2026-07-17_rollback_row_level_security.sql) já
--       lido e pronto para uso caso algo saia errado.
--   [ ] Depois de aplicar: teste manual do "dono da tabela" (seção 3.4) —
--       autenticar como tenant A, tentar ler um registro do tenant B pelo
--       ID direto; se voltar o registro em vez de null/404, FORCE RLS não
--       está funcionando como esperado e a investigação precisa continuar
--       antes de considerar isto pronto.
--   [ ] Rodar a suíte de testes (unit + e2e) contra o ambiente com RLS
--       ativo — mocks de repositório podem precisar de ajuste.
--   [ ] Medir latência antes/depois nos endpoints de maior volume (sync de
--       pedidos, DRE) — cada query agora é uma transação de 2 statements
--       em vez de 1 (ver seção 5 do doc).
--
-- Todas as tabelas abaixo já existem (aplicadas via
-- prisma/migrations/20260712124142_baseline_completo e migrations
-- posteriores) — este arquivo só adiciona RLS, nunca cria/altera colunas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: template repetido ~30x abaixo. Deixado como comentário de
-- referência (Postgres não tem macro de DDL) — cada bloco deste arquivo é
-- essa mesma forma, com schema/tabela trocados:
--
--   ALTER TABLE "<schema>"."<tabela>" ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "<schema>"."<tabela>" FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON "<schema>"."<tabela>"
--   USING (
--     current_setting('app.bypass_rls', true) = 'on'
--     OR "tenantId" = current_setting('app.current_tenant_id', true)
--   )
--   WITH CHECK (
--     current_setting('app.bypass_rls', true) = 'on'
--     OR "tenantId" = current_setting('app.current_tenant_id', true)
--   );
-- ----------------------------------------------------------------------------

BEGIN;

-- ============================================================================
-- Schema: identity
-- ============================================================================

-- "tenants" NÃO recebe RLS — é a própria tabela raiz de contas, não dado
-- pertencente a um tenant. Uma policy aqui não faria sentido conceitual
-- (contra qual tenantId compararia a si mesma?) e o próprio login/signup
-- precisa poder ler linhas de "tenants" antes de qualquer contexto de tenant
-- existir.

ALTER TABLE "identity"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity"."users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity"."users"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: catalog
-- ============================================================================

ALTER TABLE "catalog"."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."suppliers"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."tax_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."tax_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."tax_profiles"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."products" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."products"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."packagings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."packagings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."packagings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."packaging_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."packaging_usage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."packaging_usage_events"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "catalog_settings": tenantId é a própria chave primária (@id), não uma FK
-- solta — mesma policy, só muda a cardinalidade (1 linha por tenant).
ALTER TABLE "catalog"."catalog_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."catalog_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."catalog_settings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."product_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_audit_logs"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: logistics_intelligence
-- ============================================================================

-- "logistics_settings": tenantId também é @id aqui (1 linha por tenant).
ALTER TABLE "logistics_intelligence"."logistics_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_intelligence"."logistics_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_intelligence"."logistics_settings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: marketplace_intelligence
-- ============================================================================

-- "marketplaces" NÃO recebe RLS — catálogo fixo de canais suportados pela
-- plataforma (Mercado Livre, Nuvemshop, ...), igual para todos os tenants.

-- "marketplace_rules" é o ÚNICO caso ambíguo do schema inteiro: tenantId é
-- nullable (null = regra global da plataforma, ex.: tabela pública de
-- comissão do ML; preenchido = override de um tenant específico, ex.: taxa
-- negociada da Nuvemshop). Policy customizada: linha global é visível/gravável
-- por QUALQUER contexto de tenant autenticado (não só bypass) — é uma regra
-- de leitura compartilhada, não dado privado de ninguém. Override por tenant
-- segue a regra padrão.
ALTER TABLE "marketplace_intelligence"."marketplace_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."marketplace_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_intelligence"."marketplace_rules"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" IS NULL
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "marketplace_change_events" NÃO recebe RLS — trilha de detecção de mudança
-- de regra é infraestrutura de sync, referenciada por marketplaceId, nunca
-- por tenant (mesma tabela serve para revisar mudança de uma regra global OU
-- de um override de tenant).

-- "mercado_livre_connections": tenantId é @id (1 conexão por tenant).
ALTER TABLE "marketplace_intelligence"."mercado_livre_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."mercado_livre_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_intelligence"."mercado_livre_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: integration_ops
-- ============================================================================

-- "provider_sync_schedules", "provider_sync_logs", "provider_health" NÃO
-- recebem RLS — infraestrutura genérica de sincronização (quando cada
-- provider rodou, se falhou), chaveada por providerCode, nunca por tenant.
-- Mesmo racional de marketplace_change_events acima.

-- ============================================================================
-- Schema: erp_integration
-- ============================================================================

-- "olist_connections": tenantId é @id.
ALTER TABLE "erp_integration"."olist_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."olist_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "erp_integration"."olist_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "erp_integration"."erp_sync_change_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."erp_sync_change_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "erp_integration"."erp_sync_change_events"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "nuvemshop_connections": tenantId é @id.
ALTER TABLE "erp_integration"."nuvemshop_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."nuvemshop_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "erp_integration"."nuvemshop_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: channel_integration
-- ============================================================================

ALTER TABLE "channel_integration"."channel_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "channel_integration"."channel_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "channel_integration"."channel_listings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: competition_intelligence
-- ============================================================================

ALTER TABLE "competition_intelligence"."monitored_competitor_listings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."monitored_competitor_listings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "competition_intelligence"."monitored_competitor_listings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "competition_intelligence"."competitor_offer_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."competitor_offer_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "competition_intelligence"."competitor_offer_snapshots"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "competition_intelligence"."competitive_opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."competitive_opportunities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "competition_intelligence"."competitive_opportunities"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: financial_intelligence
-- ============================================================================

ALTER TABLE "financial_intelligence"."fixed_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_intelligence"."fixed_expenses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_intelligence"."fixed_expenses"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "financial_intelligence"."receivable_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_intelligence"."receivable_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_intelligence"."receivable_records"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Benchmark Tiny ERP (28/07/2026) — accounts_payable, adicionada depois do
-- desenho original de RLS (17/07). Mesmo padrão simples de tenantId próprio
-- das demais tabelas deste schema; schema financial_intelligence já coberto
-- pelo grant do app_runtime (2026-07-22), nenhum grant novo necessário.
ALTER TABLE "financial_intelligence"."accounts_payable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_intelligence"."accounts_payable" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "financial_intelligence"."accounts_payable"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: orders
-- ============================================================================

ALTER TABLE "orders"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "orders"."orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "order_items" NÃO tem tenantId próprio — escopado via FK a "orders".
-- Subquery é mais cara que comparação direta de coluna, mas evita
-- desnormalizar tenantId numa tabela que já tem uma FK forte para o dono.
ALTER TABLE "orders"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "orders"."order_items"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM "orders"."orders" o
    WHERE o.id = "order_items"."orderId"
      AND o."tenantId" = current_setting('app.current_tenant_id', true)
  )
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM "orders"."orders" o
    WHERE o.id = "order_items"."orderId"
      AND o."tenantId" = current_setting('app.current_tenant_id', true)
  )
);

-- ============================================================================
-- Schema: logistics_fulfillment
-- ============================================================================

ALTER TABLE "logistics_fulfillment"."warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."warehouses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."warehouses"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_events"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "stock_movement_audit_event_items" tem tenantId PRÓPRIO (denormalizado),
-- diferente de order_items/stock_movement_audit_event_orders — mesma policy
-- padrão de coluna direta.
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_event_items"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "logistics_fulfillment"."video_capture_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."video_capture_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."video_capture_sessions"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- "stock_movement_audit_event_orders" (chave composta, sem tenantId
-- próprio) — escopado via FK a stock_movement_audit_events (mesmo schema,
-- evita subquery cross-schema).
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_event_orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM "logistics_fulfillment"."stock_movement_audit_events" e
    WHERE e.id = "stock_movement_audit_event_orders"."auditEventId"
      AND e."tenantId" = current_setting('app.current_tenant_id', true)
  )
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM "logistics_fulfillment"."stock_movement_audit_events" e
    WHERE e.id = "stock_movement_audit_event_orders"."auditEventId"
      AND e."tenantId" = current_setting('app.current_tenant_id', true)
  )
);

ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."stock_ledger_entries"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Benchmark Tiny ERP (28/07/2026) — product_warehouse_locations, adicionada
-- depois do desenho original de RLS (17/07). Mesmo padrão simples de
-- tenantId próprio das demais tabelas deste schema.
ALTER TABLE "logistics_fulfillment"."product_warehouse_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."product_warehouse_locations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."product_warehouse_locations"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: promotion_intelligence
-- ============================================================================

ALTER TABLE "promotion_intelligence"."promotion_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotion_intelligence"."promotion_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "promotion_intelligence"."promotion_campaigns"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "promotion_intelligence"."promotion_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promotion_intelligence"."promotion_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "promotion_intelligence"."promotion_enrollments"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: marketplace_ads
-- ============================================================================

ALTER TABLE "marketplace_ads"."ads_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_ads"."ads_campaigns"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_ads"."ads_metric_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_metric_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_ads"."ads_metric_snapshots"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_ads"."ads_action_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_action_suggestions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_ads"."ads_action_suggestions"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: tagging (Sprint 28, benchmark Tiny ERP 28/07/2026) — adicionado
-- depois do desenho original de RLS (17/07). Mesmo padrão simples de
-- tenantId próprio nas duas tabelas (Tag e TagAssignment ambas têm coluna
-- "tenantId" direta, sem precisar de subquery via FK).
-- ============================================================================

ALTER TABLE "tagging"."tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tagging"."tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tagging"."tags"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "tagging"."tag_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tagging"."tag_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tagging"."tag_assignments"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Schema: procurement (Fase 1, benchmark Tiny ERP 28/07/2026) — Ordem de
-- Compra. Schema novo, precisa também do grant do app_runtime (ver
-- 2026-07-28_grant_app_runtime_procurement.sql), mesmo racional de tagging.
-- ============================================================================

ALTER TABLE "procurement"."purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement"."purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement"."purchase_orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "procurement"."purchase_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement"."purchase_order_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement"."purchase_order_items"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Lista de Preços (Fase 2, benchmark Tiny ERP 28/07/2026) — schema catalog
-- já existente (já coberto pelo grant do app_runtime via ALTER DEFAULT
-- PRIVILEGES), só precisa das policies das duas tabelas novas.
-- ============================================================================

ALTER TABLE "catalog"."price_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."price_lists" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."price_lists"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."price_list_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."price_list_exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."price_list_exceptions"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Emissão de NF-e (Fase 3, benchmark Tiny ERP, 28/07/2026) — schema fiscal
-- NOVO, precisa do grant em 2026-07-28_grant_app_runtime_fiscal.sql também.
-- ============================================================================

ALTER TABLE "fiscal"."fiscal_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal"."fiscal_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal"."fiscal_settings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "fiscal"."fiscal_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal"."fiscal_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal"."fiscal_invoices"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP,
-- 28/07/2026) — duas tabelas NOVAS no schema catalog (já coberto pelo grant
-- existente, ALTER DEFAULT PRIVILEGES já cobre tabela nova) e o schema
-- marketplace_publishing INTEIRO, NOVO, precisa do grant em
-- 2026-07-28_grant_app_runtime_marketplace_publishing.sql também.
-- ============================================================================

ALTER TABLE "catalog"."product_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_categories"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."category_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."category_attributes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."category_attributes"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_publishing"."channel_category_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_publishing"."channel_category_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_publishing"."channel_category_mappings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_publishing"."listing_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_publishing"."listing_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_publishing"."listing_publications"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Expedição em lote (Fase 5, benchmark Tiny ERP, 29/07/2026) — duas tabelas
-- NOVAS em logistics_fulfillment (já coberto pelo grant existente desde a
-- Sprint 24, ALTER DEFAULT PRIVILEGES já cobre tabela nova) e o schema
-- freight_shipping INTEIRO, NOVO, precisa do grant em
-- 2026-07-29_grant_app_runtime_freight_shipping.sql também.
-- ============================================================================

ALTER TABLE "logistics_fulfillment"."dispatch_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."dispatch_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."dispatch_batches"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."dispatch_batch_orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "freight_shipping"."freight_provider_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."freight_provider_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."freight_provider_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Grupo G da NF-e (benchmark Bling, 29/07/2026) — tabela NOVA em fiscal (já
-- coberto pelo grant existente desde a Fase 3, ALTER DEFAULT PRIVILEGES já
-- cobre tabela nova no mesmo schema).
-- ============================================================================

ALTER TABLE "fiscal"."fiscal_marketplace_intermediaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal"."fiscal_marketplace_intermediaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal"."fiscal_marketplace_intermediaries"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- ============================================================================
-- Ordens de Produção (Projeto Estruturante 1, benchmark Bling ERP,
-- 29/07/2026) — catalog.product_structure_components é tabela nova num
-- schema já existente (só a policy é nova); production é schema NOVO,
-- precisa do grant em 2026-07-29_grant_app_runtime_production.sql também.
-- ============================================================================

ALTER TABLE "catalog"."product_structure_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_structure_components" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_structure_components"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "production"."production_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production"."production_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "production"."production_orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "production"."production_order_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production"."production_order_components" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "production"."production_order_components"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Produtos-Lotes (Projeto Estruturante 2, benchmark Bling, 29/07/2026) —
-- catalog.product_lots.
ALTER TABLE "catalog"."product_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_lots"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling,
-- 29/07/2026) — sellers.vendedores (schema novo). orders.order_items
-- (colunas novas: vendedorId, comissaoAliquotaPct, comissaoValor,
-- comissaoPagaEm) já tem RLS por linha desde o bloco original de "orders" —
-- nenhuma policy nova necessária ali.
ALTER TABLE "sellers"."vendedores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sellers"."vendedores" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sellers"."vendedores"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Naturezas de Operação (Projeto Estruturante 4, benchmark Bling,
-- 29/07/2026) — fiscal.naturezas_operacao (tabela nova em schema já
-- existente). fiscal.fiscal_settings.defaultNaturezaOperacaoId é coluna nova
-- numa tabela já com RLS por linha — nenhuma policy nova necessária ali.
ALTER TABLE "fiscal"."naturezas_operacao" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal"."naturezas_operacao" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fiscal"."naturezas_operacao"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

-- Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark
-- Bling, 29/07/2026) — freight_shipping.carriers, freight_shipping.carrier_services.
ALTER TABLE "freight_shipping"."carriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."carriers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."carriers"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "freight_shipping"."carrier_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."carrier_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."carrier_services"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;

-- ============================================================================
-- Fim. 34 tabelas com RLS ativa (32 por coluna direta + marketplace_rules
-- customizada + 2 via subquery de FK) — contagem aproximada, acumulada fase a
-- fase (ver blocos acima). 6 tabelas deliberadamente sem RLS
-- (tenants, marketplaces, marketplace_change_events, provider_sync_schedules,
-- provider_sync_logs, provider_health) por serem dado global/infraestrutura,
-- não dado de cliente — ver seção 4 de docs/row-level-security-architecture.md.
--
-- Nota de comportamento: qualquer acesso ao Postgres que NÃO passe pelo
-- client Prisma "tenant-aware" da aplicação (script ad-hoc, `prisma db seed`
-- manual, psql direto) e não chamar set_config antes de consultar estas
-- tabelas vai receber ZERO linhas em SELECT e ter todo INSERT/UPDATE
-- REJEITADO — current_setting(..., true) retorna NULL quando a variável
-- nunca foi setada, e "tenantId" = NULL nunca é verdadeiro. Isso é
-- intencional (falha de forma segura, nunca silenciosa), mas pode surpreender
-- quem rodar uma manutenção manual sem saber disso.
-- ============================================================================
