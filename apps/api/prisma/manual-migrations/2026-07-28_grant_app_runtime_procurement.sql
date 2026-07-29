-- ============================================================================
-- RLS — conceder acesso do schema "procurement" (Fase 1, benchmark Tiny ERP,
-- Ordem de Compra) ao role app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-28_grant_app_runtime_tagging.sql: schema novo,
-- não coberto por 2026-07-22_create_app_runtime_role.sql (que só concedeu
-- USAGE + CRUD nos schemas que existiam naquele momento). Sem este GRANT, a
-- aplicação (roda como app_runtime, não `postgres`) recebe "permission
-- denied for schema procurement" em toda query de Ordem de Compra, mesmo com
-- RLS/policies corretas.
--
-- Rodar DEPOIS de `prisma migrate dev`/`deploy` (que cria as tabelas de
-- procurement) e depois de aplicar a policy RLS nova:
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-28_grant_app_runtime_procurement.sql
-- ============================================================================

GRANT USAGE ON SCHEMA procurement TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA procurement TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA procurement GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
