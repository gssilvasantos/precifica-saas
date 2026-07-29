-- ============================================================================
-- RLS — conceder acesso do schema "freight_shipping" (Fase 5, benchmark Tiny
-- ERP, Expedição em lote / etiqueta avulsa) ao role app_runtime
-- ============================================================================
-- Mesmo racional de 2026-07-28_grant_app_runtime_marketplace_publishing.sql:
-- schema novo, não coberto por 2026-07-22_create_app_runtime_role.sql. Sem
-- este GRANT, a aplicação (roda como app_runtime, não `postgres`) recebe
-- "permission denied for schema freight_shipping" em toda query de
-- FreightProviderConnection, mesmo com RLS/policies corretas.
--
-- Rodar DEPOIS de `prisma migrate deploy` (que cria a tabela de
-- freight_shipping) e depois de aplicar a policy RLS nova:
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-29_grant_app_runtime_freight_shipping.sql --url "<DIRECT_URL>"
-- ============================================================================

GRANT USAGE ON SCHEMA freight_shipping TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA freight_shipping TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA freight_shipping GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
