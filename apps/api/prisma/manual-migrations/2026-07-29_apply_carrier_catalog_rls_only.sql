-- ============================================================================
-- Aplicação pontual (29/07/2026): policies das tabelas NOVAS desta rodada
-- (Projeto Estruturante 5 — Catálogo de Transportador/Serviço)
-- freight_shipping.carriers, freight_shipping.carrier_services. Mesmo
-- racional de 2026-07-29_apply_dispatch_batch_and_freight_rls_only.sql: o
-- arquivo mestre 2026-07-17_enable_row_level_security.sql é a fonte de
-- verdade para um ambiente novo do zero; este arquivo existe só para aplicar
-- as policies que ainda não existem no banco de produção atual.
--
-- freight_shipping NÃO precisa de grant novo — já tem ALTER DEFAULT
-- PRIVILEGES configurado desde a Fase 5
-- (2026-07-29_grant_app_runtime_freight_shipping.sql), que cobre qualquer
-- tabela nova criada depois no mesmo schema.
--
-- Rodar DEPOIS de aplicar a migration nova (20260729240000_add_carrier_catalog):
--
--   npx prisma db execute --file prisma/manual-migrations/2026-07-29_apply_carrier_catalog_rls_only.sql --url "<DIRECT_URL>"
-- ============================================================================

BEGIN;

ALTER TABLE "freight_shipping"."carriers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."carriers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."carriers"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "freight_shipping"."carrier_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "freight_shipping"."carrier_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "freight_shipping"."carrier_services"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
