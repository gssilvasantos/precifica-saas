-- ============================================================================
-- Aplicação pontual (28/07/2026): só as policies NOVAS desta rodada
-- (catalog.product_categories, catalog.category_attributes,
-- marketplace_publishing.channel_category_mappings,
-- marketplace_publishing.listing_publications), que ainda não existem no
-- banco. O arquivo mestre 2026-07-17_enable_row_level_security.sql já
-- contém este mesmo bloco (é a fonte de verdade para reaplicar do zero num
-- ambiente novo) — este arquivo existe só porque rodar o mestre inteiro de
-- novo aqui falharia em "policy already exists" para as tabelas já
-- cobertas antes.
--
-- Precisa do GRANT em
-- 2026-07-28_grant_app_runtime_marketplace_publishing.sql também (schema
-- marketplace_publishing é NOVO, não coberto por
-- 2026-07-22_create_app_runtime_role.sql). As duas tabelas novas do schema
-- catalog NÃO precisam de grant novo — catalog já tem ALTER DEFAULT
-- PRIVILEGES configurado, que cobre tabela nova criada depois.
-- ============================================================================

BEGIN;

ALTER TABLE "catalog"."product_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."product_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."product_categories"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "catalog"."category_attributes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog"."category_attributes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalog"."category_attributes"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_publishing"."channel_category_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_publishing"."channel_category_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_publishing"."channel_category_mappings"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

ALTER TABLE "marketplace_publishing"."listing_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketplace_publishing"."listing_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketplace_publishing"."listing_publications"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR "tenantId" = current_setting('app.current_tenant_id', true)
);

COMMIT;
