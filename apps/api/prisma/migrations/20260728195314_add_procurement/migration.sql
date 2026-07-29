-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "procurement";

-- CreateEnum
CREATE TYPE "procurement"."PurchaseOrderStatus" AS ENUM ('ABERTO', 'ANDAMENTO', 'ATENDIDO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "logistics_fulfillment"."StockMovementEventType" ADD VALUE 'PURCHASE_RECEIPT';

-- CreateTable
CREATE TABLE "procurement"."purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "procurement"."PurchaseOrderStatus" NOT NULL DEFAULT 'ABERTO',
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "paymentDueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "invoiceNumber" TEXT,
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement"."purchase_order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "ipi" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "procurement"."purchase_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "purchase_order_items_tenantId_purchaseOrderId_idx" ON "procurement"."purchase_order_items"("tenantId", "purchaseOrderId");

-- AddForeignKey
ALTER TABLE "procurement"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "procurement"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
