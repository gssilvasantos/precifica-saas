-- ============================================================================
-- Aplicação pontual (14/10/2026): policy NOVA desta rodada —
-- competition_intelligence.competitive_opportunity_status_changes (tabela
-- nova, schema já existente e já coberto por
-- 2026-07-22_create_app_runtime_role.sql via ALTER DEFAULT PRIVILEGES —
-- então basta a policy; sem GRANT separado necessário para esta tabela).
--
-- Mesmo racional de 2026-07-29_apply_sellers_rls_only.sql: o arquivo mestre
-- 2026-07-17_enable_row_level_security.sql não cobre tabela criada depois
-- dele, então o patch pontual vive aqui.
--
-- Rodar DEPOIS de `prisma migrate deploy` (que cria a tabela
-- competitive_opportunity_status_changes):
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-10-14_apply_competitive_opportunity_status_changes_rls_only.sql
-- ============================================================================

BEGIN;

ALTER TABLE "competition_intelligence"."competitive_opportunity_status_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "competition_intelligence"."competitive_opportunity_status_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "competition_intelligence"."competitive_opportunity_status_changes"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
