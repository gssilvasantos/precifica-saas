-- ============================================================================
-- RLS — conceder acesso do schema "tagging" (Sprint 28, benchmark Tiny ERP)
-- ao role app_runtime
-- ============================================================================
-- 2026-07-22_create_app_runtime_role.sql já rodou em produção (task #256) e
-- concedeu USAGE + CRUD só nos 13 schemas que existiam NAQUELE momento. O
-- schema "tagging" (Tag/TagAssignment) é novo — sem este GRANT adicional, a
-- aplicação (que roda como app_runtime, não como `postgres`, desde aquela
-- migração) receberia "permission denied for schema tagging" em toda query
-- de tag, mesmo com RLS/policies corretas em 2026-07-17_enable_row_level_security.sql.
--
-- Rodar DEPOIS de 2026-07-17_enable_row_level_security.sql (que cria as
-- tabelas de tagging via `prisma migrate dev`/`deploy` e habilita RLS
-- nelas) e depois que app_runtime já existir (2026-07-22 já aplicado):
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-28_grant_app_runtime_tagging.sql
--
-- (usa DIRECT_URL, role `postgres` — GRANT é DDL, mesma razão de sempre.)
-- ============================================================================

GRANT USAGE ON SCHEMA tagging TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tagging TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA tagging GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
