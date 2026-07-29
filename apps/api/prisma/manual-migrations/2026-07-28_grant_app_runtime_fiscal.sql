-- ============================================================================
-- RLS — conceder acesso do schema "fiscal" (Fase 3, benchmark Tiny ERP,
-- Emissão de NF-e) ao role app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-28_grant_app_runtime_procurement.sql: schema
-- novo, não coberto por 2026-07-22_create_app_runtime_role.sql. Sem este
-- GRANT, a aplicação (roda como app_runtime, não `postgres`) recebe
-- "permission denied for schema fiscal" em toda query de NF-e, mesmo com
-- RLS/policies corretas.
--
-- Rodar DEPOIS de `prisma migrate dev`/`deploy` (que cria as tabelas de
-- fiscal) e depois de aplicar a policy RLS nova:
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-28_grant_app_runtime_fiscal.sql --url "<DIRECT_URL>"
-- ============================================================================

GRANT USAGE ON SCHEMA fiscal TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fiscal TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA fiscal GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
