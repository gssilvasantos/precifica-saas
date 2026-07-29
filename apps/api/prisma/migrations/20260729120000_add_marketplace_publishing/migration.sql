-- Migração retroativa (29/07/2026) — captura em SQL o schema da Fase 4
-- (Publicar anúncio novo em marketplace, task #342, 28/07/2026), que foi
-- construído em schema.prisma mas cuja migração nunca chegou a ser escrita
-- como arquivo Prisma nesta pasta (gap descoberto ao investigar a Fase 5).
-- Idempotente (IF NOT EXISTS / DO $$ ... EXCEPTION) para poder rodar com
-- segurança mesmo que uma parte já tenha sido aplicada manualmente antes.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "marketplace_publishing";

-- Árvore de categoria interna + atributos por categoria (catalog)
CREATE TABLE IF NOT EXISTS "catalog"."product_categories" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "catalog"."category_attributes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "attributeValue" TEXT NOT NULL,
    "extendToChildren" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_categories_tenantId_idx" ON "catalog"."product_categories"("tenantId");
CREATE INDEX IF NOT EXISTS "product_categories_tenantId_parentCategoryId_idx" ON "catalog"."product_categories"("tenantId", "parentCategoryId");
CREATE UNIQUE INDEX IF NOT EXISTS "category_attributes_categoryId_attributeName_key" ON "catalog"."category_attributes"("categoryId", "attributeName");
CREATE INDEX IF NOT EXISTS "category_attributes_tenantId_categoryId_idx" ON "catalog"."category_attributes"("tenantId", "categoryId");

DO $$ BEGIN
    ALTER TABLE "catalog"."product_categories" ADD CONSTRAINT "product_categories_parentCategoryId_fkey"
        FOREIGN KEY ("parentCategoryId") REFERENCES "catalog"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "catalog"."category_attributes" ADD CONSTRAINT "category_attributes_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "catalog"."product_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Product.categoryId (pré-requisito para publicar anúncio, opcional)
ALTER TABLE "catalog"."products" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
CREATE INDEX IF NOT EXISTS "products_tenantId_categoryId_idx" ON "catalog"."products"("tenantId", "categoryId");

DO $$ BEGIN
    ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "catalog"."product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Mapeamento categoria x canal + tentativas de publicação (marketplace_publishing)
DO $$ BEGIN
    CREATE TYPE "marketplace_publishing"."ListingPublicationStatus" AS ENUM ('PENDENTE', 'PUBLICADO', 'ERRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "marketplace_publishing"."channel_category_mappings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "marketplaceCode" TEXT NOT NULL,
    "externalCategoryId" TEXT NOT NULL,
    "externalCategoryName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_category_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_category_mappings_tenantId_categoryId_marketplaceCo_key" ON "marketplace_publishing"."channel_category_mappings"("tenantId", "categoryId", "marketplaceCode");
CREATE INDEX IF NOT EXISTS "channel_category_mappings_tenantId_marketplaceCode_idx" ON "marketplace_publishing"."channel_category_mappings"("tenantId", "marketplaceCode");

CREATE TABLE IF NOT EXISTS "marketplace_publishing"."listing_publications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "marketplaceCode" TEXT NOT NULL,
    "status" "marketplace_publishing"."ListingPublicationStatus" NOT NULL DEFAULT 'PENDENTE',
    "externalListingId" TEXT,
    "requestPayload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_publications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "listing_publications_tenantId_productId_idx" ON "marketplace_publishing"."listing_publications"("tenantId", "productId");
CREATE INDEX IF NOT EXISTS "listing_publications_tenantId_marketplaceCode_status_idx" ON "marketplace_publishing"."listing_publications"("tenantId", "marketplaceCode", "status");
