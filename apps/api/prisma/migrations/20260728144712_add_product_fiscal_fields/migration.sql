-- AlterTable
ALTER TABLE "catalog"."products" ADD COLUMN     "fiscalOriginCode" INTEGER,
ADD COLUMN     "gtin" TEXT,
ADD COLUMN     "ncm" TEXT;

-- RenameIndex
ALTER INDEX "orders"."orders_tenantId_channelCode_status_shippingStatusCheckedAt_orde" RENAME TO "orders_tenantId_channelCode_status_shippingStatusCheckedAt__idx";
