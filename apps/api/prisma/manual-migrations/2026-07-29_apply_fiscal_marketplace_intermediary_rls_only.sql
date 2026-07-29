-- ============================================================================
-- Aplicação pontual (29/07/2026): policy da tabela NOVA desta rodada
-- (fiscal.fiscal_marketplace_intermediaries — benchmark Bling, seção 1.4).
-- Mesmo racional de 2026-07-28_apply_fiscal_rls_only.sql: o arquivo mestre
-- 2026-07-17_enable_row_level_security.sql é a fonte de verdade para um
-- ambiente novo do zero; este arquivo existe só para aplicar a policy que
-- ainda não existe no banco de produção atual.
--
-- fiscal NÃO precisa de grant novo — já tem ALTER DEFAULT PRIVILEGES
-- configurado desde a Fase 3 (2026-07-28_grant_app_runtime_fiscal.sql), que
-- cobre qualquer tabela nova criada depois no mesmo schema.
--
-- Rodar DEPOIS de aplicar a migration nova
-- (20260729140000_add_fiscal_marketplace_intermediary):
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-29_apply_fiscal_marketplace_intermediary_rls_only.sql --url "<DIRECT_URL>"
-- ============================================================================

BEGIN;

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

COMMIT;
