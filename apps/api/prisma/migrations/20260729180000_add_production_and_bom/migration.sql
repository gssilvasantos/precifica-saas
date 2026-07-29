-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "production";

-- AlterEnum
ALTER TYPE "logistics_fulfillment"."StockMovementEventType" ADD VALUE 'PRODUCTION_OUTPUT';

-- CreateTable (BOM real — catalog, atributo do produto kit)
CREATE TABLE "catalog"."product_structure_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentSkuCode" TEXT NOT NULL,
    "componentSkuCode" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_structure_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_structure_components_tenantId_parentSkuCode_compo_key" ON "catalog"."product_structure_components"("tenantId", "parentSkuCode", "componentSkuCode");

-- CreateIndex
CREATE INDEX "product_structure_components_tenantId_parentSkuCode_idx" ON "catalog"."product_structure_components"("tenantId", "parentSkuCode");

-- CreateEnum
CREATE TYPE "production"."ProductionOrderStatus" AS ENUM ('RASCUNHO', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "production"."production_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "production"."ProductionOrderStatus" NOT NULL DEFAULT 'RASCUNHO',
    "parentSkuCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "notes" TEXT,
    "concludedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_orders_tenantId_status_idx" ON "production"."production_orders"("tenantId", "status");

-- CreateTable
CREATE TABLE "production"."production_order_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "componentSkuCode" TEXT NOT NULL,
    "quantityPerUnit" DECIMAL(12,3) NOT NULL,
    "totalQuantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_order_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_components_productionOrderId_componentSk_key" ON "production"."production_order_components"("productionOrderId", "componentSkuCode");

-- CreateIndex
CREATE INDEX "production_order_components_tenantId_productionOrderId_idx" ON "production"."production_order_components"("tenantId", "productionOrderId");

-- AddForeignKey
ALTER TABLE "production"."production_order_components" ADD CONSTRAINT "production_order_components_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production"."production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
