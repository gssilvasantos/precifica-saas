-- ============================================================================
-- RLS — conceder acesso do schema "production" (Projeto Estruturante 1,
-- benchmark Bling ERP, Ordens de Produção) ao role app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-28_grant_app_runtime_procurement.sql: schema
-- novo, não coberto por 2026-07-22_create_app_runtime_role.sql. Sem este
-- GRANT, a aplicação (roda como app_runtime, não `postgres`) recebe
-- "permission denied for schema production" em toda query de Ordem de
-- Produção, mesmo com RLS/policies corretas.
--
-- catalog.product_structure_components NÃO precisa de grant separado — é
-- tabela nova num schema já existente, coberto pelo ALTER DEFAULT PRIVILEGES
-- de catalog desde 2026-07-22_create_app_runtime_role.sql.
--
-- Rodar DEPOIS de `prisma migrate dev`/`deploy` (que cria as tabelas de
-- production) e depois de aplicar a policy RLS nova:
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_grant_app_runtime_production.sql
-- ============================================================================

GRANT USAGE ON SCHEMA production TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA production TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA production GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
