-- CreateTable
CREATE TABLE "fiscal"."naturezas_operacao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cfopVendaInterno" TEXT NOT NULL,
    "cfopVendaInterestadual" TEXT NOT NULL,
    "cfopDevolucaoInterno" TEXT,
    "cfopDevolucaoInterestadual" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "naturezas_operacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "naturezas_operacao_tenantId_nome_key" ON "fiscal"."naturezas_operacao"("tenantId", "nome");

-- CreateIndex
CREATE INDEX "naturezas_operacao_tenantId_isActive_idx" ON "fiscal"."naturezas_operacao"("tenantId", "isActive");

-- AlterTable (Naturezas de Operação — natureza padrão do tenant, ver schema.prisma)
ALTER TABLE "fiscal"."fiscal_settings" ADD COLUMN "defaultNaturezaOperacaoId" TEXT;

-- AddForeignKey
ALTER TABLE "fiscal"."fiscal_settings" ADD CONSTRAINT "fiscal_settings_defaultNaturezaOperacaoId_fkey" FOREIGN KEY ("defaultNaturezaOperacaoId") REFERENCES "fiscal"."naturezas_operacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;
