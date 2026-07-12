-- AlterTable
ALTER TABLE "catalog"."catalog_settings" ADD COLUMN     "minProfitMarginPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 0;
