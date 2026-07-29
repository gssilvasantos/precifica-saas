-- ============================================================================
-- RLS — conceder acesso do schema "sellers" (Projeto Estruturante 3,
-- benchmark Bling ERP, Vendedores + Comissão) ao role app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-29_grant_app_runtime_production.sql: schema
-- novo, não coberto por 2026-07-22_create_app_runtime_role.sql. Sem este
-- GRANT, a aplicação (roda como app_runtime, não `postgres`) recebe
-- "permission denied for schema sellers" em toda query de Vendedor, mesmo
-- com RLS/policies corretas.
--
-- orders.order_items (colunas novas: vendedorId, comissaoAliquotaPct,
-- comissaoValor, comissaoPagaEm) NÃO precisa de grant separado — é ALTER
-- TABLE numa tabela já existente num schema já coberto.
--
-- Rodar DEPOIS de `prisma migrate deploy` (que cria a tabela
-- sellers.vendedores) e ANTES da policy RLS nova:
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_grant_app_runtime_sellers.sql
-- ============================================================================

GRANT USAGE ON SCHEMA sellers TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sellers TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA sellers GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
