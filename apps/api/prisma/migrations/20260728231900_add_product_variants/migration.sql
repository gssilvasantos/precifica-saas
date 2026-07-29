-- AlterTable
ALTER TABLE "catalog"."products" ADD COLUMN     "parentProductId" TEXT,
ADD COLUMN     "variantAttributes" JSONB;

-- CreateIndex
CREATE INDEX "products_tenantId_parentProductId_idx" ON "catalog"."products"("tenantId", "parentProductId");

-- AddForeignKey
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "catalog"."products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
