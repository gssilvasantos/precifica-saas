-- ============================================================================
-- Aplicação pontual (28/07/2026): só a policy NOVA desta rodada
-- (accounts_payable), que ainda não existe no banco. O arquivo mestre
-- 2026-07-17_enable_row_level_security.sql já contém este mesmo bloco (é a
-- fonte de verdade para reaplicar do zero num ambiente novo) — este arquivo
-- existe só porque rodar o mestre inteiro de novo aqui falharia em "policy
-- already exists" para as tabelas já cobertas antes.
-- ============================================================================

BEGIN;

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

COMMIT;
