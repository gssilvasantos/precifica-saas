-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "sellers";

-- CreateTable
CREATE TABLE "sellers"."vendedores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "aliquotaComissaoPct" DECIMAL(5,2) NOT NULL,
    "descontoMaximoPct" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendedores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendedores_tenantId_idx" ON "sellers"."vendedores"("tenantId");

-- CreateIndex
CREATE INDEX "vendedores_tenantId_isActive_idx" ON "sellers"."vendedores"("tenantId", "isActive");

-- AlterTable (Vendedores + Comissão — snapshot no OrderItem, ver schema.prisma)
ALTER TABLE "orders"."order_items"
ADD COLUMN "vendedorId" TEXT,
ADD COLUMN "comissaoAliquotaPct" DECIMAL(5,2),
ADD COLUMN "comissaoValor" DECIMAL(12,2),
ADD COLUMN "comissaoPagaEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "order_items_vendedorId_comissaoPagaEm_idx" ON "orders"."order_items"("vendedorId", "comissaoPagaEm");
