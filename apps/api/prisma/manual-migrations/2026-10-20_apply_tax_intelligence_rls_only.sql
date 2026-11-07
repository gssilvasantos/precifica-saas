-- ============================================================================
-- Correção de drift (20/10/2026): o schema "tax_intelligence" foi criado pela
-- migration 20260802120000_add_tax_intelligence (02/08/2026) e só recebeu o
-- GRANT ao role app_runtime em 18/09/2026
-- (2026-09-18_grant_app_runtime_tax_intelligence.sql) — mas NUNCA recebeu a
-- RLS correspondente. Achado durante auditoria com a skill
-- supabase-postgres-best-practices (20/10/2026): como app_runtime não tem
-- BYPASSRLS mas a tabela nunca teve ENABLE ROW LEVEL SECURITY, não havia
-- NENHUMA policy em vigor — qualquer conexão via app_runtime lia/gravava as
-- 3 tabelas abaixo (tenant_tax_profiles, product_tax_profiles,
-- tenant_prior_revenues, todas com tenantId) sem isolamento entre tenants,
-- apesar de o GRANT já estar restrito ao papel certo. Isto é exatamente o
-- "risco de drift nº1" descrito no CLAUDE.md da raiz: todo schema/tabela
-- novo exige o par apply_*_rls_only.sql + grant_app_runtime_*.sql, e aqui só
-- o segundo tinha sido feito.
--
-- Mesmo padrão de policy de todas as outras tabelas do projeto (ver
-- 2026-07-17_enable_row_level_security.sql, a fonte de referência).
-- ============================================================================

BEGIN;

ALTER TABLE "tax_intelligence"."tenant_tax_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."tenant_tax_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_intelligence"."tenant_tax_profiles"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "tax_intelligence"."product_tax_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."product_tax_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_intelligence"."product_tax_profiles"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "tax_intelligence"."tenant_prior_revenues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."tenant_prior_revenues" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_intelligence"."tenant_prior_revenues"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;

-- Aplicação (precisa ser executado pelo role `postgres`, dono das tabelas —
-- role app_runtime não tem privilégio pra ALTER TABLE/CREATE POLICY):
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-10-20_apply_tax_intelligence_rls_only.sql
-- ============================================================================
