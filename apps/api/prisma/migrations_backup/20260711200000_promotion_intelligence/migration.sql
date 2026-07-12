-- Motor de Cálculo de Margem de Promoções (Sprint 26).
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão das migrações anteriores):
-- este ambiente de sandbox não tem acesso a um Postgres real nem consegue
-- baixar os binários de engine do Prisma (rede bloqueada), então não é
-- possível executar `npx prisma migrate dev` interativamente aqui. Este
-- arquivo foi escrito à mão para refletir o diff que o Prisma geraria entre
-- a última migração aplicada (20260711190000_order_audit_mode) e o
-- schema.prisma atual.
--
-- Rode `npx prisma migrate dev` localmente para gerar/confirmar a migração
-- oficial e reconciliar o histórico — em particular, os schemas
-- "logistics_fulfillment", "orders" e "financial_intelligence" também não
-- têm uma migração própria neste histórico (foram adicionados ao
-- schema.prisma em sprints anteriores deste mesmo ambiente restrito); este
-- arquivo assume que essas tabelas já existem. Se `prisma migrate dev`
-- reclamar de drift, é esperado — é exatamente para detectar e reconciliar
-- isso que o comando existe.

CREATE SCHEMA IF NOT EXISTS "promotion_intelligence";

-- --- Warehouse: custo operacional do depósito ---
ALTER TABLE "logistics_fulfillment"."warehouses"
  ADD COLUMN "logisticsCostPerUnit" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- --- Packaging: hierarquia de resolução (STANDARD/GROUPING/MASTER/SAFETY_DEFAULT) ---
CREATE TYPE "catalog"."PackagingPurpose" AS ENUM ('STANDARD', 'GROUPING', 'MASTER', 'SAFETY_DEFAULT');

ALTER TABLE "catalog"."packagings"
  ADD COLUMN "purpose" "catalog"."PackagingPurpose" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "maxCapacityKg" DOUBLE PRECISION;

CREATE INDEX "packagings_tenantId_purpose_idx" ON "catalog"."packagings"("tenantId", "purpose");

-- --- Product: marcação de kit/combo (reaproveita packagingId já existente) ---
ALTER TABLE "catalog"."products"
  ADD COLUMN "isKit" BOOLEAN NOT NULL DEFAULT false;

-- --- Promotion Intelligence: schema novo ---
CREATE TYPE "promotion_intelligence"."PromotionCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "promotion_intelligence"."MarginStatus" AS ENUM ('VERDE', 'VERMELHO');
CREATE TYPE "promotion_intelligence"."EnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

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

CREATE INDEX "promotion_campaigns_tenantId_channelCode_status_idx" ON "promotion_intelligence"."promotion_campaigns"("tenantId", "channelCode", "status");

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

CREATE UNIQUE INDEX "promotion_enrollments_campaignId_skuCode_key" ON "promotion_intelligence"."promotion_enrollments"("campaignId", "skuCode");
CREATE INDEX "promotion_enrollments_tenantId_marginStatus_idx" ON "promotion_intelligence"."promotion_enrollments"("tenantId", "marginStatus");

ALTER TABLE "promotion_intelligence"."promotion_enrollments"
  ADD CONSTRAINT "promotion_enrollments_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "promotion_intelligence"."promotion_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
