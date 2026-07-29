-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "tagging";

-- CreateEnum
CREATE TYPE "tagging"."TaggableEntityType" AS ENUM ('PRODUCT', 'ORDER', 'FIXED_EXPENSE');

-- CreateTable
CREATE TABLE "logistics_fulfillment"."product_warehouse_locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tagging"."tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tagging"."tag_assignments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "entityType" "tagging"."TaggableEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_warehouse_locations_tenantId_warehouseId_skuCode_key" ON "logistics_fulfillment"."product_warehouse_locations"("tenantId", "warehouseId", "skuCode");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenantId_name_key" ON "tagging"."tags"("tenantId", "name");

-- CreateIndex
CREATE INDEX "tag_assignments_tenantId_entityType_entityId_idx" ON "tagging"."tag_assignments"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "tag_assignments_tenantId_tagId_entityType_entityId_key" ON "tagging"."tag_assignments"("tenantId", "tagId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "logistics_fulfillment"."product_warehouse_locations" ADD CONSTRAINT "product_warehouse_locations_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "logistics_fulfillment"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tagging"."tag_assignments" ADD CONSTRAINT "tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tagging"."tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
