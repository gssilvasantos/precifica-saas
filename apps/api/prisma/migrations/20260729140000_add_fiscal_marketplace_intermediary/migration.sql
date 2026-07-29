-- Benchmark Bling (29/07/2026, ver docs/bling-erp-benchmark-analysis.md,
-- seção 1.4) — Grupo G da NF-e (Identificação do Intermediador da
-- Transação, NT 2020.006), obrigatório em venda via marketplace.
-- Idempotente (IF NOT EXISTS) seguindo o mesmo padrão das migrações
-- retroativas desta base.

CREATE TABLE IF NOT EXISTS "fiscal"."fiscal_marketplace_intermediaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "idCadIntTran" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_marketplace_intermediaries_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'fiscal' AND indexname = 'fiscal_marketplace_intermediaries_tenantId_channelCode_key'
    ) THEN
        CREATE UNIQUE INDEX "fiscal_marketplace_intermediaries_tenantId_channelCode_key"
            ON "fiscal"."fiscal_marketplace_intermediaries"("tenantId", "channelCode");
    END IF;
END $$;
