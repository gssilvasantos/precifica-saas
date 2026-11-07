-- ============================================================================
-- Correção de drift (20/10/2026), achada na mesma auditoria do arquivo
-- 2026-10-20_apply_tax_intelligence_rls_only.sql: duas tabelas com tenantId,
-- em schemas que JÁ tinham RLS aplicada em outras tabelas-irmãs, mas que
-- ficaram de fora quando foram criadas:
--
-- - marketplace_intelligence.shopee_connections (credenciais OAuth da
--   Shopee por tenant) — migration 20260727120000_shopee_connection; as
--   tabelas-irmãs do mesmo schema (marketplace_rules,
--   mercado_livre_connections, channel_seller_profiles) já tinham RLS desde
--   2026-07-17/2026-08-01, esta não entrou em nenhuma rodada.
-- - marketplace_ads.ads_item_metric_snapshots — migration
--   20260716140000_ads_ai_optimization; as tabelas-irmãs (ads_campaigns,
--   ads_metric_snapshots, ads_action_suggestions) já tinham RLS desde
--   2026-07-17/2026-07-29, esta não entrou em nenhuma rodada.
--
-- Ambos os schemas já têm GRANT ao app_runtime desde a migration-base
-- (2026-07-22_create_app_runtime_role.sql, via ALTER DEFAULT PRIVILEGES) —
-- só a RLS destas 2 tabelas específicas faltava.
-- ============================================================================

BEGIN;

ALTER TABLE "marketplace_intelligence"."shopee_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."shopee_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_intelligence"."shopee_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_ads"."ads_item_metric_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_ads"."ads_item_metric_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_ads"."ads_item_metric_snapshots"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;

-- Aplicação (role `postgres`):
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-10-20_apply_shopee_and_ads_item_metrics_rls_only.sql
-- ============================================================================
