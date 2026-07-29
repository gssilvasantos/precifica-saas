-- AlterTable (catalog.products — flag de controle de lote)
ALTER TABLE "catalog"."products" ADD COLUMN "controlaLote" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "catalog"."ProductLotStatus" AS ENUM ('ATIVO', 'INATIVO');

-- CreateTable
CREATE TABLE "catalog"."product_lots" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "dataFabricacao" TIMESTAMP(3),
    "dataValidade" TIMESTAMP(3) NOT NULL,
    "diasPermitidoVenda" INTEGER NOT NULL DEFAULT 0,
    "codigoAgregacao" TEXT,
    "status" "catalog"."ProductLotStatus" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_tenantId_skuCode_lotCode_key" ON "catalog"."product_lots"("tenantId", "skuCode", "lotCode");

-- CreateIndex
CREATE INDEX "product_lots_tenantId_skuCode_idx" ON "catalog"."product_lots"("tenantId", "skuCode");

-- CreateIndex
CREATE INDEX "product_lots_tenantId_dataValidade_idx" ON "catalog"."product_lots"("tenantId", "dataValidade");

-- AlterEnum (logistics_fulfillment.StockMovementEventType — lançamento manual por lote)
ALTER TYPE "logistics_fulfillment"."StockMovementEventType" ADD VALUE 'LOT_ADJUSTMENT';

-- AlterTable (logistics_fulfillment.stock_movement_audit_events — justificativa textual genérica)
ALTER TABLE "logistics_fulfillment"."stock_movement_audit_events" ADD COLUMN "notes" TEXT;

-- AlterTable (logistics_fulfillment.stock_ledger_entries — dimensão de lote, aditiva)
ALTER TABLE "logistics_fulfillment"."stock_ledger_entries" ADD COLUMN "lotCode" TEXT;

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenantId_warehouseId_skuCode_lotCode_idx" ON "logistics_fulfillment"."stock_ledger_entries"("tenantId", "warehouseId", "skuCode", "lotCode");
