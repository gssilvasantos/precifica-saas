-- Tax Intelligence (02/08/2026) — ver docs/tributacao-br-regimes-e-reforma.md
--
-- Aditiva: novo schema, nenhuma tabela existente alterada. CatalogSettings.taxRatePct
-- e catalog.TaxProfile.estimatedRatePct continuam existindo e funcionando; a
-- substituição é feita em etapa posterior, com os consumidores migrados um a um.
--
-- O tema deste schema é VIGÊNCIA: regime do tenant, ST do produto e (adiante)
-- adesão a IBS/CBS mudam no tempo, e mês fechado não pode mudar de valor
-- retroativamente.

CREATE SCHEMA IF NOT EXISTS "tax_intelligence";
GRANT USAGE ON SCHEMA "tax_intelligence" TO "app_runtime";

DO $$ BEGIN
  CREATE TYPE "tax_intelligence"."TaxRegimeKind" AS ENUM ('MEI_SIMEI','SIMPLES_NACIONAL','LUCRO_PRESUMIDO','LUCRO_REAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "tax_intelligence"."SimplesAnexoKind" AS ENUM ('I','II','III','IV','V');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "tax_intelligence"."TaxAutomationMode" AS ENUM ('AUTO','MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "tax_intelligence"."tenant_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "regime" "tax_intelligence"."TaxRegimeKind" NOT NULL,
    "anexo" "tax_intelligence"."SimplesAnexoKind",
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "meiValorFixoMensal" DECIMAL(10,2),
    "automationMode" "tax_intelligence"."TaxAutomationMode" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_tax_profiles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tenant_tax_profiles_tenantId_vigenciaInicio_idx"
  ON "tax_intelligence"."tenant_tax_profiles"("tenantId","vigenciaInicio");

CREATE TABLE IF NOT EXISTS "tax_intelligence"."product_tax_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "vigenciaInicio" TIMESTAMP(3) NOT NULL,
    "vigenciaFim" TIMESTAMP(3),
    "icmsSt" BOOLEAN NOT NULL DEFAULT false,
    "monofasico" BOOLEAN NOT NULL DEFAULT false,
    "ncm" TEXT,
    "fonte" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_tax_profiles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "product_tax_profiles_tenantId_productId_uf_vigenciaInicio_idx"
  ON "tax_intelligence"."product_tax_profiles"("tenantId","productId","uf","vigenciaInicio");

CREATE TABLE IF NOT EXISTS "tax_intelligence"."tenant_prior_revenues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competencia" TIMESTAMP(3) NOT NULL,
    "receitaMercadoInterno" DECIMAL(14,2) NOT NULL,
    "receitaMercadoExterno" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fonte" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_prior_revenues_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_prior_revenues_tenantId_competencia_key"
  ON "tax_intelligence"."tenant_prior_revenues"("tenantId","competencia");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA "tax_intelligence" TO "app_runtime";

-- RLS na MESMA transação do CREATE TABLE — uma tabela multi-tenant nunca deve
-- existir, nem por um instante, sem isolamento. FORCE porque o dono da tabela
-- (postgres) ignoraria a policy sem ele.
ALTER TABLE "tax_intelligence"."tenant_tax_profiles"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."tenant_tax_profiles"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."product_tax_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."product_tax_profiles" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."tenant_prior_revenues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_intelligence"."tenant_prior_revenues" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tax_intelligence"."tenant_tax_profiles"
  FOR ALL USING (
    (current_setting('app.bypass_rls', true) = 'on')
    OR ("tenantId" = current_setting('app.current_tenant_id', true))
  );

CREATE POLICY "tenant_isolation" ON "tax_intelligence"."product_tax_profiles"
  FOR ALL USING (
    (current_setting('app.bypass_rls', true) = 'on')
    OR ("tenantId" = current_setting('app.current_tenant_id', true))
  );

CREATE POLICY "tenant_isolation" ON "tax_intelligence"."tenant_prior_revenues"
  FOR ALL USING (
    (current_setting('app.bypass_rls', true) = 'on')
    OR ("tenantId" = current_setting('app.current_tenant_id', true))
  );
