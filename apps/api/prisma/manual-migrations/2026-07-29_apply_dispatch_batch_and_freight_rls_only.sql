-- ============================================================================
-- Aplicação pontual (29/07/2026): policies das tabelas NOVAS da Fase 5
-- (Expedição em lote) — logistics_fulfillment.dispatch_batches,
-- logistics_fulfillment.dispatch_batch_orders,
-- freight_shipping.freight_provider_connections. Mesmo racional de
-- 2026-07-28_apply_marketplace_publishing_rls_only.sql: o arquivo mestre
-- 2026-07-17_enable_row_level_security.sql é a fonte de verdade para um
-- ambiente novo do zero; este arquivo existe só para aplicar as policies
-- que ainda não existem no banco de produção atual.
--
-- Precisa do GRANT em
-- 2026-07-29_grant_app_runtime_freight_shipping.sql também (schema
-- freight_shipping é NOVO). logistics_fulfillment NÃO precisa de grant novo
-- — já tem ALTER DEFAULT PRIVILEGES configurado desde a Sprint 24, que cobre
-- qualquer tabela nova criada depois no mesmo schema.
--
-- Rodar DEPOIS de aplicar as duas migrations novas
-- (20260729120000_add_marketplace_publishing e
-- 20260729130000_add_dispatch_batch_and_freight):
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-29_apply_dispatch_batch_and_freight_rls_only.sql --url "<DIRECT_URL>"
-- ============================================================================

BEGIN;

ALTER TABLE "logistics_fulfillment"."dispatch_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."dispatch_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."dispatch_batches"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "logistics_fulfillment"."dispatch_batch_orders"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "freight_shipping"."freight_provider_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."freight_provider_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."freight_provider_connections"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
