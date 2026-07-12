-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "channel_integration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "competition_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "erp_integration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "integration_ops";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "logistics_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "marketplace_intelligence";

-- CreateEnum
CREATE TYPE "identity"."UserRole" AS ENUM ('ADMIN', 'PRICING_EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "catalog"."TaxRegime" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI', 'OUTRO');

-- CreateEnum
CREATE TYPE "catalog"."ProductSourceSystem" AS ENUM ('MANUAL', 'ERP_OLIST');

-- CreateEnum
CREATE TYPE "marketplace_intelligence"."RuleType" AS ENUM ('FEE_RULE', 'SHIPPING_POLICY', 'CATEGORY_TAXONOMY');

-- CreateEnum
CREATE TYPE "marketplace_intelligence"."DataSourceType" AS ENUM ('OFFICIAL_API', 'OFFICIAL_DOCS', 'IMPORTED_FILE', 'MANUAL');

-- CreateEnum
CREATE TYPE "marketplace_intelligence"."RuleStatus" AS ENUM ('PENDENTE_VALIDACAO', 'VALIDADA', 'DESATUALIZADA', 'OBSOLETA');

-- CreateEnum
CREATE TYPE "marketplace_intelligence"."ChangeResolution" AS ENUM ('AUTO_APPLIED', 'PENDING_REVIEW', 'REJECTED', 'APPLIED_MANUALLY');

-- CreateEnum
CREATE TYPE "competition_intelligence"."CompetitionRadarSourceType" AS ENUM ('SCRAPING', 'PARTNER_API', 'INTERNAL_MONITORING');

-- CreateEnum
CREATE TYPE "competition_intelligence"."BuyBoxStatus" AS ENUM ('WINNING', 'LOSING', 'UNKNOWN');

-- CreateTable
CREATE TABLE "identity"."tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity"."users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "identity"."UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "leadTimeDays" INTEGER,
    "paymentTerms" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."tax_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regime" "catalog"."TaxRegime" NOT NULL,
    "estimatedRatePct" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "internalCategory" TEXT,
    "supplierId" TEXT,
    "taxProfileId" TEXT,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "desiredMarginPct" DOUBLE PRECISION NOT NULL,
    "minimumMarginPct" DOUBLE PRECISION NOT NULL,
    "autoRepricingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "packagingWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "packedWeightKg" DOUBLE PRECISION NOT NULL,
    "lengthCm" DOUBLE PRECISION NOT NULL,
    "widthCm" DOUBLE PRECISION NOT NULL,
    "heightCm" DOUBLE PRECISION NOT NULL,
    "cubicWeightKg" DOUBLE PRECISION NOT NULL,
    "shippingWeightKg" DOUBLE PRECISION NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "erpSalePrice" DECIMAL(12,2),
    "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceSystem" "catalog"."ProductSourceSystem" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_settings" (
    "tenantId" TEXT NOT NULL,
    "defaultDesiredMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "defaultMinimumMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "logistics_intelligence"."logistics_settings" (
    "tenantId" TEXT NOT NULL,
    "cubicWeightFactor" INTEGER NOT NULL DEFAULT 6000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "logistics_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "marketplace_intelligence"."marketplaces" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_intelligence"."marketplace_rules" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "ruleType" "marketplace_intelligence"."RuleType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "marketplace_intelligence"."RuleStatus" NOT NULL DEFAULT 'PENDENTE_VALIDACAO',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" "marketplace_intelligence"."DataSourceType" NOT NULL,
    "sourceProviderCode" TEXT NOT NULL,
    "sourceFetchedAt" TIMESTAMP(3) NOT NULL,
    "sourceEvidenceRef" TEXT,
    "contentHash" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_intelligence"."marketplace_change_events" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "ruleType" "marketplace_intelligence"."RuleType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "previousRuleId" TEXT,
    "newRuleId" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "detectedByProvider" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolutionStatus" "marketplace_intelligence"."ChangeResolution" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "marketplace_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_ops"."provider_sync_schedules" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoTrust" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,

    CONSTRAINT "provider_sync_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_ops"."provider_sync_logs" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "candidatesApplied" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" TEXT,

    CONSTRAINT "provider_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_ops"."provider_health" (
    "providerCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_health_pkey" PRIMARY KEY ("providerCode")
);

-- CreateTable
CREATE TABLE "erp_integration"."olist_connections" (
    "tenantId" TEXT NOT NULL,
    "apiTokenEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "olist_connections_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "erp_integration"."erp_sync_change_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erp_sync_change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_integration"."nuvemshop_connections" (
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nuvemshop_connections_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "channel_integration"."channel_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "currentPrice" DECIMAL(12,2),
    "url" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_intelligence"."monitored_competitor_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "competitorLabel" TEXT NOT NULL,
    "targetRef" TEXT NOT NULL,
    "radarCode" TEXT NOT NULL,
    "channelCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitored_competitor_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_intelligence"."competitor_offer_snapshots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "competitorLabel" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isBuyBoxWinner" BOOLEAN,
    "sourceRadarCode" TEXT NOT NULL,
    "sourceEvidenceRef" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_offer_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competition_intelligence"."competitive_opportunities" (
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "bestCompetitorPrice" DECIMAL(12,2) NOT NULL,
    "bestCompetitorLabel" TEXT NOT NULL,
    "ourPrice" DECIMAL(12,2),
    "channelCode" TEXT,
    "priceGapPct" DOUBLE PRECISION NOT NULL,
    "buyBoxStatus" "competition_intelligence"."BuyBoxStatus" NOT NULL DEFAULT 'UNKNOWN',
    "rank" INTEGER,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitive_opportunities_pkey" PRIMARY KEY ("tenantId","skuCode")
);

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "identity"."users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "identity"."users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "suppliers_tenantId_idx" ON "catalog"."suppliers"("tenantId");

-- CreateIndex
CREATE INDEX "tax_profiles_tenantId_idx" ON "catalog"."tax_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "catalog"."products"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_skuCode_key" ON "catalog"."products"("tenantId", "skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sourceSystem_externalId_key" ON "catalog"."products"("tenantId", "sourceSystem", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplaces_code_key" ON "marketplace_intelligence"."marketplaces"("code");

-- CreateIndex
CREATE INDEX "marketplace_rules_marketplaceId_ruleType_scopeKey_status_idx" ON "marketplace_intelligence"."marketplace_rules"("marketplaceId", "ruleType", "scopeKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_rules_marketplaceId_ruleType_scopeKey_version_t_key" ON "marketplace_intelligence"."marketplace_rules"("marketplaceId", "ruleType", "scopeKey", "version", "tenantId");

-- CreateIndex
CREATE INDEX "marketplace_change_events_marketplaceId_detectedAt_idx" ON "marketplace_intelligence"."marketplace_change_events"("marketplaceId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_sync_schedules_providerCode_key" ON "integration_ops"."provider_sync_schedules"("providerCode");

-- CreateIndex
CREATE INDEX "provider_sync_logs_providerCode_startedAt_idx" ON "integration_ops"."provider_sync_logs"("providerCode", "startedAt");

-- CreateIndex
CREATE INDEX "erp_sync_change_events_tenantId_syncedAt_idx" ON "erp_integration"."erp_sync_change_events"("tenantId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "erp_sync_change_events_tenantId_externalId_key" ON "erp_integration"."erp_sync_change_events"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "channel_listings_tenantId_skuCode_idx" ON "channel_integration"."channel_listings"("tenantId", "skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "channel_listings_tenantId_channelCode_externalId_key" ON "channel_integration"."channel_listings"("tenantId", "channelCode", "externalId");

-- CreateIndex
CREATE INDEX "monitored_competitor_listings_tenantId_isActive_idx" ON "competition_intelligence"."monitored_competitor_listings"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "monitored_competitor_listings_tenantId_skuCode_targetRef_key" ON "competition_intelligence"."monitored_competitor_listings"("tenantId", "skuCode", "targetRef");

-- CreateIndex
CREATE INDEX "competitor_offer_snapshots_tenantId_skuCode_collectedAt_idx" ON "competition_intelligence"."competitor_offer_snapshots"("tenantId", "skuCode", "collectedAt");

-- AddForeignKey
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "identity"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "catalog"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "catalog"."tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_intelligence"."marketplace_rules" ADD CONSTRAINT "marketplace_rules_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplace_intelligence"."marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_intelligence"."marketplace_change_events" ADD CONSTRAINT "marketplace_change_events_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplace_intelligence"."marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
