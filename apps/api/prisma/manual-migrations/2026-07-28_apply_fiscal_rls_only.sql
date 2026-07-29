-- ============================================================================
-- Aplicação pontual (28/07/2026): só as policies NOVAS desta rodada
-- (fiscal.fiscal_settings + fiscal.fiscal_invoices), que ainda não existem
-- no banco. O arquivo mestre 2026-07-17_enable_row_level_security.sql já
-- contém este mesmo bloco (é a fonte de verdade para reaplicar do zero num
-- ambiente novo) — este arquivo existe só porque rodar o mestre inteiro de
-- novo aqui falharia em "policy already exists" para as tabelas já
-- cobertas antes.
--
-- Precisa do GRANT em 2026-07-28_grant_app_runtime_fiscal.sql também
-- (schema novo, não coberto por 2026-07-22_create_app_runtime_role.sql).
-- ============================================================================

BEGIN;

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

COMMIT;
