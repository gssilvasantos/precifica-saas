-- ============================================================================
-- Aplicação pontual (29/07/2026): policy NOVA desta rodada
-- (catalog.product_lots) — tabela nova num schema já existente (catalog),
-- não precisa de GRANT separado (coberto por ALTER DEFAULT PRIVILEGES desde
-- a criação do role app_runtime), só da policy de RLS. O arquivo mestre
-- 2026-07-17_enable_row_level_security.sql já contém este mesmo bloco
-- (fonte de verdade para reaplicar do zero) — este arquivo existe só porque
-- rodar o mestre inteiro de novo aqui falharia em "policy already exists"
-- para as tabelas já cobertas antes.
--
-- Rodar DEPOIS de `npx prisma migrate deploy` (que cria a tabela
-- catalog.product_lots e as colunas novas desta migration):
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_product_lots_rls_only.sql
-- ============================================================================

BEGIN;

ALTER TABLE "catalog"."product_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_lots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_lots"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
