-- Fase 5 (Expedição em lote), benchmark Tiny ERP, 29/07/2026 — ver
-- docs/tiny-erp-benchmark-analysis.md, seção 1.2, e
-- docs/dispatch-batch-architecture.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "freight_shipping";

-- Extensão do Hub de Provas (logistics_fulfillment) com o agrupamento de lote
DO $$ BEGIN
    CREATE TYPE "logistics_fulfillment"."DispatchBatchStatus" AS ENUM ('ABERTO', 'ETIQUETADO', 'DESPACHADO', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "logistics_fulfillment"."DispatchBatchOrderStatus" AS ENUM ('PENDENTE', 'ETIQUETADO', 'ERRO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "logistics_fulfillment"."dispatch_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "formaEnvio" TEXT NOT NULL,
    "status" "logistics_fulfillment"."DispatchBatchStatus" NOT NULL DEFAULT 'ABERTO',
    "requestedByUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "concludedAt" TIMESTAMP(3),

    CONSTRAINT "dispatch_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dispatch_batches_tenantId_status_idx" ON "logistics_fulfillment"."dispatch_batches"("tenantId", "status");

CREATE TABLE IF NOT EXISTS "logistics_fulfillment"."dispatch_batch_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dispatchBatchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "logistics_fulfillment"."DispatchBatchOrderStatus" NOT NULL DEFAULT 'PENDENTE',
    "externalLabelId" TEXT,
    "trackingCode" TEXT,
    "labelUrl" TEXT,
    "errorMessage" TEXT,
    "labeledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatch_batch_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_batch_orders_dispatchBatchId_orderId_key" ON "logistics_fulfillment"."dispatch_batch_orders"("dispatchBatchId", "orderId");
CREATE INDEX IF NOT EXISTS "dispatch_batch_orders_tenantId_orderId_idx" ON "logistics_fulfillment"."dispatch_batch_orders"("tenantId", "orderId");

DO $$ BEGIN
    ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" ADD CONSTRAINT "dispatch_batch_orders_dispatchBatchId_fkey"
        FOREIGN KEY ("dispatchBatchId") REFERENCES "logistics_fulfillment"."dispatch_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "logistics_fulfillment"."dispatch_batch_orders" ADD CONSTRAINT "dispatch_batch_orders_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "orders"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Conexão/credencial por tenant de transportadora avulsa (Melhor Envio,
-- Correios, Frenet) — ver comentário do model no schema.prisma.
CREATE TABLE IF NOT EXISTS "freight_shipping"."freight_provider_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "credentialEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freight_provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "freight_provider_connections_tenantId_providerCode_key" ON "freight_shipping"."freight_provider_connections"("tenantId", "providerCode");
