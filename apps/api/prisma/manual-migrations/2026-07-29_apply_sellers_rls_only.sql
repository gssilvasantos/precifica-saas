-- ============================================================================
-- Aplicação pontual (29/07/2026): policy NOVA desta rodada
-- (sellers.vendedores) — schema novo, tabela nova, precisa de RLS. O arquivo
-- mestre 2026-07-17_enable_row_level_security.sql já contém este mesmo bloco
-- (fonte de verdade para reaplicar do zero) — este arquivo existe só porque
-- rodar o mestre inteiro de novo aqui falharia em "policy already exists"
-- para as tabelas já cobertas antes.
--
-- orders.order_items já tem RLS (política existente cobre as colunas novas
-- automaticamente — RLS é por LINHA, não por coluna) — nenhuma mudança de
-- policy necessária ali.
--
-- Rodar DEPOIS de 2026-07-29_grant_app_runtime_sellers.sql:
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_sellers_rls_only.sql
-- ============================================================================

BEGIN;

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

COMMIT;
