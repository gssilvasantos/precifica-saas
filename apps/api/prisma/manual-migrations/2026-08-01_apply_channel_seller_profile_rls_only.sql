-- ============================================================================
-- Aplicação pontual (01/08/2026): policy NOVA desta rodada
-- (marketplace_intelligence.channel_seller_profiles) — tabela nova, precisa
-- de RLS. Mesmo racional de 2026-07-29_apply_sellers_rls_only.sql: o arquivo
-- mestre 2026-07-17_enable_row_level_security.sql continua sendo a fonte de
-- verdade para reaplicar do zero; este existe só porque rodar o mestre
-- inteiro de novo falharia em "policy already exists" nas tabelas já
-- cobertas.
--
-- logistics_fulfillment.warehouses já tem RLS — a coluna nova
-- (estimatedFreightCost) é coberta automaticamente pela policy existente,
-- porque RLS é por LINHA, não por coluna. Nenhuma mudança de policy ali.
--
-- GRANT: o schema marketplace_intelligence já está coberto por
-- 2026-07-22_create_app_runtime_role.sql, que inclui ALTER DEFAULT
-- PRIVILEGES — então a tabela nova herda o acesso automaticamente por ter
-- sido criada pelo mesmo role (`postgres`, via DIRECT_URL). O GRANT
-- explícito abaixo é redundante nesse caminho feliz e existe como rede de
-- segurança: se a tabela um dia for criada por outro role, o default
-- privilege não se aplica e a aplicação (app_runtime) receberia "permission
-- denied" numa tela que antes funcionava.
--
-- Rodar DEPOIS de `prisma migrate deploy`:
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-08-01_apply_channel_seller_profile_rls_only.sql
-- ============================================================================

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "marketplace_intelligence"."channel_seller_profiles" TO app_runtime;

ALTER TABLE "marketplace_intelligence"."channel_seller_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_intelligence"."channel_seller_profiles" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "marketplace_intelligence"."channel_seller_profiles"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
