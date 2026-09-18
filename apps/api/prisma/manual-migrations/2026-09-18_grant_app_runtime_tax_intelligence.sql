-- ============================================================================
-- RLS — conceder acesso do schema "tax_intelligence" ao role app_runtime
-- ============================================================================
-- Achado durante a investigação de 18/09/2026 (crash loop em produção — ver
-- docs/auth-security.md ou o relato da sessão): o schema "tax_intelligence"
-- foi criado pela migration 20260802120000_add_tax_intelligence (aplicada em
-- produção em 2026-08-11), mas nunca ganhou o arquivo de grant correspondente
-- — todos os schemas anteriores criados depois de
-- 2026-07-22_create_app_runtime_role.sql (fiscal, marketplace_publishing,
-- procurement, tagging, freight_shipping, production, sellers) têm o par
-- apply_*_rls_only.sql + grant_app_runtime_*.sql; tax_intelligence é o único
-- que ficou sem. Sem este GRANT, a aplicação (roda como app_runtime, não
-- `postgres`) recebe "permission denied for schema tax_intelligence" em toda
-- query de ProductTaxProfile/TenantTaxProfile/TenantPriorRevenue, mesmo com
-- RLS/policies corretas.
--
-- Mesmo racional dos demais grants de schema novo — ver
-- 2026-07-28_grant_app_runtime_procurement.sql para o padrão original.
--
-- Rodar com o role `postgres` (via DIRECT_URL — GRANT é DDL):
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-09-18_grant_app_runtime_tax_intelligence.sql
-- ============================================================================

GRANT USAGE ON SCHEMA tax_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tax_intelligence TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA tax_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
