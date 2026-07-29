-- ============================================================================
-- Aplicação pontual (28/07/2026): só as policies NOVAS desta rodada
-- (procurement.purchase_orders + procurement.purchase_order_items), que
-- ainda não existem no banco. O arquivo mestre
-- 2026-07-17_enable_row_level_security.sql já contém este mesmo bloco (é a
-- fonte de verdade para reaplicar do zero num ambiente novo) — este arquivo
-- existe só porque rodar o mestre inteiro de novo aqui falharia em "policy
-- already exists" para as tabelas já cobertas antes.
-- ============================================================================

BEGIN;

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

COMMIT;
