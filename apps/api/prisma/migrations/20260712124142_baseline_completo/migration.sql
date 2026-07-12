-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "channel_integration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "competition_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "erp_integration";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "financial_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "integration_ops";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "logistics_fulfillment";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "logistics_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "marketplace_intelligence";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "orders";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "promotion_intelligence";

-- CreateEnum
CREATE TYPE "identity"."UserRole" AS ENUM ('ADMIN', 'PRICING_EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "catalog"."TaxRegime" AS ENUM ('SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI', 'OUTRO');

-- CreateEnum
CREATE TYPE "catalog"."ProductSourceSystem" AS ENUM ('MANUAL', 'ERP_OLIST');

-- CreateEnum
CREATE TYPE "catalog"."PackagingPurpose" AS ENUM ('STANDARD', 'GROUPING', 'MASTER', 'SAFETY_DEFAULT');

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

-- CreateEnum
CREATE TYPE "financial_intelligence"."FixedExpenseRecurrence" AS ENUM ('MONTHLY', 'WEEKLY', 'YEARLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "financial_intelligence"."ReceivableStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "orders"."OrderStatus" AS ENUM ('EM_ABERTO', 'PREPARANDO_ENVIO', 'FATURADO', 'ENVIADO', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "orders"."FiscalResponsibility" AS ENUM ('SELLER', 'MARKETPLACE');

-- CreateEnum
CREATE TYPE "logistics_fulfillment"."WarehouseType" AS ENUM ('PHYSICAL', 'VIRTUAL_FULL');

-- CreateEnum
CREATE TYPE "logistics_fulfillment"."StockMovementEventType" AS ENUM ('FULL_DISPATCH', 'RETAIL_SHIPMENT');

-- CreateEnum
CREATE TYPE "logistics_fulfillment"."ConferenceStatus" AS ENUM ('PENDENTE', 'APROVADO', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "logistics_fulfillment"."VideoCaptureStatus" AS ENUM ('RECORDING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "promotion_intelligence"."PromotionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "promotion_intelligence"."MarginStatus" AS ENUM ('VERDE', 'VERMELHO');

-- CreateEnum
CREATE TYPE "promotion_intelligence"."EnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

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
    "packagingId" TEXT,
    "isKit" BOOLEAN NOT NULL DEFAULT false,
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
CREATE TABLE "catalog"."packagings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightG" DOUBLE PRECISION NOT NULL,
    "heightCm" DOUBLE PRECISION NOT NULL,
    "widthCm" DOUBLE PRECISION NOT NULL,
    "lengthCm" DOUBLE PRECISION NOT NULL,
    "costPrice" DECIMAL(12,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "purpose" "catalog"."PackagingPurpose" NOT NULL DEFAULT 'STANDARD',
    "maxCapacityKg" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packagings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."packaging_usage_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "packagingId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitCostPrice" DECIMAL(12,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."catalog_settings" (
    "tenantId" TEXT NOT NULL,
    "defaultDesiredMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "defaultMinimumMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minProfitMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
CREATE TABLE "marketplace_intelligence"."mercado_livre_connections" (
    "tenantId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL DEFAULT 'bearer',
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mercado_livre_connections_pkey" PRIMARY KEY ("tenantId")
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

-- CreateTable
CREATE TABLE "financial_intelligence"."fixed_expenses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "recurrenceType" "financial_intelligence"."FixedExpenseRecurrence" NOT NULL,
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_intelligence"."receivable_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "financial_intelligence"."ReceivableStatus" NOT NULL DEFAULT 'PENDING',
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "marketplaceSource" TEXT NOT NULL,
    "externalReference" TEXT,
    "skuCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivable_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "externalOrderId" TEXT NOT NULL,
    "status" "orders"."OrderStatus" NOT NULL DEFAULT 'EM_ABERTO',
    "externalStatus" TEXT NOT NULL,
    "subtotalAmount" DECIMAL(12,2) NOT NULL,
    "shippingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fiscalResponsibility" "orders"."FiscalResponsibility" NOT NULL DEFAULT 'SELLER',
    "buyerTaxId" TEXT,
    "invoiceNumber" TEXT,
    "shippingDeadlineAt" TIMESTAMP(3),
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders"."order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "skuCode" TEXT,
    "externalSku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2),
    "costPrice" DECIMAL(12,2),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."warehouses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "logistics_fulfillment"."WarehouseType" NOT NULL,
    "channelCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 15,
    "logisticsCostPerUnit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."stock_movement_audit_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" "logistics_fulfillment"."StockMovementEventType" NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "conferenceStatus" "logistics_fulfillment"."ConferenceStatus" NOT NULL DEFAULT 'PENDENTE',
    "conferredByUserId" TEXT,
    "conferredAt" TIMESTAMP(3),
    "divergenceNotes" TEXT,
    "invoiceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_movement_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."stock_movement_audit_event_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "scannedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_movement_audit_event_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."video_capture_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "logistics_fulfillment"."VideoCaptureStatus" NOT NULL DEFAULT 'RECORDING',
    "receivedChunkCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "videoDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_capture_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" (
    "auditEventId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "stock_movement_audit_event_orders_pkey" PRIMARY KEY ("auditEventId","orderId")
);

-- CreateTable
CREATE TABLE "logistics_fulfillment"."stock_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_intelligence"."promotion_campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "promotion_intelligence"."PromotionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_intelligence"."promotion_enrollments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "promotionalPrice" DECIMAL(12,2) NOT NULL,
    "costPriceUsed" DECIMAL(12,2) NOT NULL,
    "feesAmount" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "logisticsCost" DECIMAL(12,2) NOT NULL,
    "netMarginAmount" DECIMAL(12,2) NOT NULL,
    "netMarginPct" DOUBLE PRECISION NOT NULL,
    "marginStatus" "promotion_intelligence"."MarginStatus" NOT NULL,
    "enrollmentStatus" "promotion_intelligence"."EnrollmentStatus" NOT NULL DEFAULT 'PENDING',
    "blockedReason" TEXT,
    "feeRuleFound" BOOLEAN NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_enrollments_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "packagings_tenantId_idx" ON "catalog"."packagings"("tenantId");

-- CreateIndex
CREATE INDEX "packagings_tenantId_purpose_idx" ON "catalog"."packagings"("tenantId", "purpose");

-- CreateIndex
CREATE INDEX "packaging_usage_events_tenantId_productId_occurredAt_idx" ON "catalog"."packaging_usage_events"("tenantId", "productId", "occurredAt");

-- CreateIndex
CREATE INDEX "packaging_usage_events_tenantId_packagingId_occurredAt_idx" ON "catalog"."packaging_usage_events"("tenantId", "packagingId", "occurredAt");

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

-- CreateIndex
CREATE INDEX "fixed_expenses_tenantId_idx" ON "financial_intelligence"."fixed_expenses"("tenantId");

-- CreateIndex
CREATE INDEX "receivable_records_tenantId_status_expectedDate_idx" ON "financial_intelligence"."receivable_records"("tenantId", "status", "expectedDate");

-- CreateIndex
CREATE INDEX "receivable_records_tenantId_marketplaceSource_externalRefer_idx" ON "financial_intelligence"."receivable_records"("tenantId", "marketplaceSource", "externalReference");

-- CreateIndex
CREATE INDEX "orders_tenantId_status_orderedAt_idx" ON "orders"."orders"("tenantId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_channelCode_orderedAt_idx" ON "orders"."orders"("tenantId", "channelCode", "orderedAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_isDemo_idx" ON "orders"."orders"("tenantId", "isDemo");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_channelCode_externalOrderId_key" ON "orders"."orders"("tenantId", "channelCode", "externalOrderId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "orders"."order_items"("orderId");

-- CreateIndex
CREATE INDEX "warehouses_tenantId_type_idx" ON "logistics_fulfillment"."warehouses"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_code_key" ON "logistics_fulfillment"."warehouses"("tenantId", "code");

-- CreateIndex
CREATE INDEX "stock_movement_audit_events_tenantId_conferenceStatus_idx" ON "logistics_fulfillment"."stock_movement_audit_events"("tenantId", "conferenceStatus");

-- CreateIndex
CREATE INDEX "stock_movement_audit_events_tenantId_eventType_createdAt_idx" ON "logistics_fulfillment"."stock_movement_audit_events"("tenantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movement_audit_event_items_tenantId_auditEventId_idx" ON "logistics_fulfillment"."stock_movement_audit_event_items"("tenantId", "auditEventId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_audit_event_items_auditEventId_skuCode_key" ON "logistics_fulfillment"."stock_movement_audit_event_items"("auditEventId", "skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "video_capture_sessions_auditEventId_key" ON "logistics_fulfillment"."video_capture_sessions"("auditEventId");

-- CreateIndex
CREATE INDEX "video_capture_sessions_tenantId_status_idx" ON "logistics_fulfillment"."video_capture_sessions"("tenantId", "status");

-- CreateIndex
CREATE INDEX "video_capture_sessions_finalizedAt_idx" ON "logistics_fulfillment"."video_capture_sessions"("finalizedAt");

-- CreateIndex
CREATE INDEX "stock_movement_audit_event_orders_orderId_idx" ON "logistics_fulfillment"."stock_movement_audit_event_orders"("orderId");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenantId_warehouseId_skuCode_idx" ON "logistics_fulfillment"."stock_ledger_entries"("tenantId", "warehouseId", "skuCode");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_auditEventId_idx" ON "logistics_fulfillment"."stock_ledger_entries"("auditEventId");

-- CreateIndex
CREATE INDEX "promotion_campaigns_tenantId_channelCode_status_idx" ON "promotion_intelligence"."promotion_campaigns"("tenantId", "channelCode", "status");

-- CreateIndex
CREATE INDEX "promotion_enrollments_tenantId_marginStatus_idx" ON "promotion_intelligence"."promotion_enrollments"("tenantId", "marginStatus");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_enrollments_campaignId_skuCode_key" ON "promotion_intelligence"."promotion_enrollments"("campaignId", "skuCode");

-- AddForeignKey
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "identity"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "catalog"."suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "catalog"."tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "catalog"."packagings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."packaging_usage_events" ADD CONSTRAINT "packaging_usage_events_packagingId_fkey" FOREIGN KEY ("packagingId") REFERENCES "catalog"."packagings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_intelligence"."marketplace_rules" ADD CONSTRAINT "marketplace_rules_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplace_intelligence"."marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_intelligence"."marketplace_change_events" ADD CONSTRAINT "marketplace_change_events_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplace_intelligence"."marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders"."order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" ADD CONSTRAINT "stock_movement_audit_events_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "logistics_fulfillment"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" ADD CONSTRAINT "stock_movement_audit_events_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "logistics_fulfillment"."warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items" ADD CONSTRAINT "stock_movement_audit_event_items_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."video_capture_sessions" ADD CONSTRAINT "video_capture_sessions_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" ADD CONSTRAINT "stock_movement_audit_event_orders_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_orders" ADD CONSTRAINT "stock_movement_audit_event_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "logistics_fulfillment"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_intelligence"."promotion_enrollments" ADD CONSTRAINT "promotion_enrollments_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "promotion_intelligence"."promotion_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
