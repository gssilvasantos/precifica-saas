-- CreateTable
CREATE TABLE "catalog"."price_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "adjustmentPct" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."price_list_exceptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "overridePrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_lists_tenantId_idx" ON "catalog"."price_lists"("tenantId");

-- CreateIndex
CREATE INDEX "price_list_exceptions_tenantId_priceListId_idx" ON "catalog"."price_list_exceptions"("tenantId", "priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_exceptions_priceListId_productId_key" ON "catalog"."price_list_exceptions"("priceListId", "productId");

-- AddForeignKey
ALTER TABLE "catalog"."price_list_exceptions" ADD CONSTRAINT "price_list_exceptions_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "catalog"."price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."price_list_exceptions" ADD CONSTRAINT "price_list_exceptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
