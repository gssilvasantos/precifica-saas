-- ============================================================================
-- Row-Level Security (RLS) — ROLLBACK ("botão de desfazer")
-- ============================================================================
-- Reverte exatamente o que 2026-07-17_enable_row_level_security.sql aplicou:
-- remove a policy `tenant_isolation` de cada tabela e desliga RLS (ENABLE e
-- FORCE). Não apaga nenhuma linha, não altera nenhuma coluna — só desfaz a
-- camada de proteção do banco, deixando o isolamento por tenant de volta
-- inteiramente nas mãos do filtro `WHERE "tenantId" = $1` que cada
-- repositório Prisma já faz na aplicação (o comportamento de hoje, antes
-- desta mudança).
--
-- Quando usar: se algo em staging (ou, na pior hipótese, produção) quebrar
-- de um jeito que pareça ligado a RLS — erro "sem contexto de tenant"
-- inesperado, latência muito acima do previsto, ou qualquer sintoma de
-- cliente sem conseguir ver dado que deveria ver — rodar isto imediatamente
-- devolve o banco ao estado anterior sem precisar reverter nenhum deploy de
-- código (o código da aplicação continua funcionando normalmente com ou sem
-- RLS ativa no banco — ele só para de reforçar a segunda camada).
--
-- Aplicação, mesma forma do arquivo de ida (usar DIRECT_URL, nunca a
-- DATABASE_URL pooled):
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-17_rollback_row_level_security.sql
--
-- Depois de rodar isto, TenantContextStore/TenantContextInterceptor/
-- PrismaService (código da aplicação) continuam ativos e continuam abrindo
-- set_config a cada query — isso é inofensivo com RLS desligada no banco
-- (só um SELECT extra por transação, sem efeito de segurança nenhum), então
-- não é preciso reverter nenhum código junto, só este SQL.
-- ============================================================================

BEGIN;

-- ---- identity ----
DROP POLICY IF EXISTS tenant_isolation ON "identity"."users";
ALTER TABLE "identity"."users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "identity"."users" DISABLE ROW LEVEL SECURITY;

-- ---- catalog ----
DROP POLICY IF EXISTS tenant_isolation ON "catalog"."suppliers";
ALTER TABLE "catalog"."suppliers" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."suppliers" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."tax_profiles";
ALTER TABLE "catalog"."tax_profiles" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."tax_profiles" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."products";
ALTER TABLE "catalog"."products" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."products" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."packagings";
ALTER TABLE "catalog"."packagings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."packagings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."packaging_usage_events";
ALTER TABLE "catalog"."packaging_usage_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."packaging_usage_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."catalog_settings";
ALTER TABLE "catalog"."catalog_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."catalog_settings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "catalog"."product_audit_logs";
ALTER TABLE "catalog"."product_audit_logs" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_audit_logs" DISABLE ROW LEVEL SECURITY;

-- ---- logistics_intelligence ----
DROP POLICY IF EXISTS tenant_isolation ON "logistics_intelligence"."logistics_settings";
ALTER TABLE "logistics_intelligence"."logistics_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_intelligence"."logistics_settings" DISABLE ROW LEVEL SECURITY;

-- ---- marketplace_intelligence ----
DROP POLICY IF EXISTS tenant_isolation ON "marketplace_intelligence"."marketplace_rules";
ALTER TABLE "marketplace_intelligence"."marketplace_rules" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."marketplace_rules" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "marketplace_intelligence"."mercado_livre_connections";
ALTER TABLE "marketplace_intelligence"."mercado_livre_connections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."mercado_livre_connections" DISABLE ROW LEVEL SECURITY;

-- ---- erp_integration ----
DROP POLICY IF EXISTS tenant_isolation ON "erp_integration"."olist_connections";
ALTER TABLE "erp_integration"."olist_connections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."olist_connections" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "erp_integration"."erp_sync_change_events";
ALTER TABLE "erp_integration"."erp_sync_change_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."erp_sync_change_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "erp_integration"."nuvemshop_connections";
ALTER TABLE "erp_integration"."nuvemshop_connections" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "erp_integration"."nuvemshop_connections" DISABLE ROW LEVEL SECURITY;

-- ---- channel_integration ----
DROP POLICY IF EXISTS tenant_isolation ON "channel_integration"."channel_listings";
ALTER TABLE "channel_integration"."channel_listings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "channel_integration"."channel_listings" DISABLE ROW LEVEL SECURITY;

-- ---- competition_intelligence ----
DROP POLICY IF EXISTS tenant_isolation ON "competition_intelligence"."monitored_competitor_listings";
ALTER TABLE "competition_intelligence"."monitored_competitor_listings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."monitored_competitor_listings" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "competition_intelligence"."competitor_offer_snapshots";
ALTER TABLE "competition_intelligence"."competitor_offer_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."competitor_offer_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "competition_intelligence"."competitive_opportunities";
ALTER TABLE "competition_intelligence"."competitive_opportunities" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."competitive_opportunities" DISABLE ROW LEVEL SECURITY;

-- ---- financial_intelligence ----
DROP POLICY IF EXISTS tenant_isolation ON "financial_intelligence"."fixed_expenses";
ALTER TABLE "financial_intelligence"."fixed_expenses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_intelligence"."fixed_expenses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "financial_intelligence"."receivable_records";
ALTER TABLE "financial_intelligence"."receivable_records" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "financial_intelligence"."receivable_records" DISABLE ROW LEVEL SECURITY;

-- ---- orders ----
DROP POLICY IF EXISTS tenant_isolation ON "orders"."orders";
ALTER TABLE "orders"."orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders"."orders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "orders"."order_items";
ALTER TABLE "orders"."order_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders"."order_items" DISABLE ROW LEVEL SECURITY;

-- ---- logistics_fulfillment ----
DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."warehouses";
ALTER TABLE "logistics_fulfillment"."warehouses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."warehouses" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_events";
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_event_items";
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."video_capture_sessions";
ALTER TABLE "logistics_fulfillment"."video_capture_sessions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."video_capture_sessions" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."stock_movement_audit_event_orders";
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "logistics_fulfillment"."stock_ledger_entries";
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" DISABLE ROW LEVEL SECURITY;

-- ---- promotion_intelligence ----
DROP POLICY IF EXISTS tenant_isolation ON "promotion_intelligence"."promotion_campaigns";
ALTER TABLE "promotion_intelligence"."promotion_campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "promotion_intelligence"."promotion_campaigns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "promotion_intelligence"."promotion_enrollments";
ALTER TABLE "promotion_intelligence"."promotion_enrollments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "promotion_intelligence"."promotion_enrollments" DISABLE ROW LEVEL SECURITY;

-- ---- marketplace_ads ----
DROP POLICY IF EXISTS tenant_isolation ON "marketplace_ads"."ads_campaigns";
ALTER TABLE "marketplace_ads"."ads_campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_campaigns" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "marketplace_ads"."ads_metric_snapshots";
ALTER TABLE "marketplace_ads"."ads_metric_snapshots" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_metric_snapshots" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "marketplace_ads"."ads_action_suggestions";
ALTER TABLE "marketplace_ads"."ads_action_suggestions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_action_suggestions" DISABLE ROW LEVEL SECURITY;

COMMIT;

-- ============================================================================
-- Fim. Todas as 30 tabelas de volta ao estado pré-RLS: sem policy, sem
-- ENABLE/FORCE. O isolamento por tenant volta a depender inteiramente do
-- filtro na aplicação (estado idêntico a antes desta mudança).
-- ============================================================================
