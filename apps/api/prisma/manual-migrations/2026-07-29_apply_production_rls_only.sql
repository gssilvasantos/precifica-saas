-- ============================================================================
-- Aplicação pontual (29/07/2026): policies NOVAS desta rodada
-- (catalog.product_structure_components + production.production_orders +
-- production.production_order_components), que ainda não existem no banco.
-- O arquivo mestre 2026-07-17_enable_row_level_security.sql já contém este
-- mesmo bloco (fonte de verdade para reaplicar do zero) — este arquivo
-- existe só porque rodar o mestre inteiro de novo aqui falharia em "policy
-- already exists" para as tabelas já cobertas antes.
--
-- Rodar DEPOIS de 2026-07-29_grant_app_runtime_production.sql:
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_production_rls_only.sql
-- ============================================================================

BEGIN;

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

COMMIT;
