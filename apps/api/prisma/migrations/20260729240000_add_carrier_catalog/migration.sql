-- CreateTable
CREATE TABLE "freight_shipping"."carriers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_shipping"."carrier_services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "carrierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estimativaEntregaDias" INTEGER,
    "automationCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carriers_tenantId_name_key" ON "freight_shipping"."carriers"("tenantId", "name");

-- CreateIndex
CREATE INDEX "carriers_tenantId_isActive_idx" ON "freight_shipping"."carriers"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_services_carrierId_name_key" ON "freight_shipping"."carrier_services"("carrierId", "name");

-- CreateIndex
CREATE INDEX "carrier_services_tenantId_isActive_idx" ON "freight_shipping"."carrier_services"("tenantId", "isActive");

-- AddForeignKey
ALTER TABLE "freight_shipping"."carrier_services" ADD CONSTRAINT "carrier_services_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "freight_shipping"."carriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
