-- ============================================================================
-- Aplicação pontual (28/07/2026): só as policies NOVAS desta rodada
-- (product_warehouse_locations + tagging.*), que ainda não existem no banco.
-- O arquivo mestre 2026-07-17_enable_row_level_security.sql já contém estes
-- mesmos blocos (é a fonte de verdade para reaplicar do zero num ambiente
-- novo) — este arquivo existe só porque rodar o mestre inteiro de novo aqui
-- falharia em "policy already exists" para as ~30 tabelas já cobertas antes.
-- ============================================================================

BEGIN;

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

COMMIT;
