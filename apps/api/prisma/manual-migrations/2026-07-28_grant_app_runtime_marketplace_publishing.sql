-- ============================================================================
-- RLS — conceder acesso do schema "marketplace_publishing" (Fase 4,
-- benchmark Tiny ERP, Publicar anúncio novo em marketplace) ao role
-- app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-28_grant_app_runtime_fiscal.sql: schema novo,
-- não coberto por 2026-07-22_create_app_runtime_role.sql. Sem este GRANT, a
-- aplicação (roda como app_runtime, não `postgres`) recebe "permission
-- denied for schema marketplace_publishing" em toda query de
-- ChannelCategoryMapping/ListingPublication, mesmo com RLS/policies
-- corretas.
--
-- Rodar DEPOIS de `prisma migrate dev`/`deploy` (que cria as tabelas de
-- marketplace_publishing) e depois de aplicar a policy RLS nova:
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-28_grant_app_runtime_marketplace_publishing.sql --url "<DIRECT_URL>"
-- ============================================================================

GRANT USAGE ON SCHEMA marketplace_publishing TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketplace_publishing TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace_publishing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
