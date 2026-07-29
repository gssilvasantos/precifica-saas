-- ============================================================================
-- Aplicação pontual (28/07/2026): só as policies NOVAS desta rodada
-- (catalog.price_lists + catalog.price_list_exceptions), que ainda não
-- existem no banco. O arquivo mestre 2026-07-17_enable_row_level_security.sql
-- já contém este mesmo bloco (é a fonte de verdade para reaplicar do zero
-- num ambiente novo) — este arquivo existe só porque rodar o mestre inteiro
-- de novo aqui falharia em "policy already exists" para as tabelas já
-- cobertas antes. Schema catalog já existente — sem grant novo necessário
-- (app_runtime já tem ALTER DEFAULT PRIVILEGES nesse schema).
-- ============================================================================

BEGIN;

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

COMMIT;
