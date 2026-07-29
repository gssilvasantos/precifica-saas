-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "fiscal";

-- CreateEnum
CREATE TYPE "fiscal"."FiscalInvoiceStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'AUTORIZADA', 'ERRO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "fiscal"."FiscalEnvironment" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');

-- CreateTable
CREATE TABLE "fiscal"."fiscal_settings" (
    "tenantId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "inscricaoEstadual" TEXT NOT NULL,
    "regimeTributario" INTEGER NOT NULL DEFAULT 1,
    "logradouro" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "bairro" TEXT NOT NULL,
    "municipio" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "telefone" TEXT,
    "focusNfeTokenEnc" TEXT NOT NULL,
    "environment" "fiscal"."FiscalEnvironment" NOT NULL DEFAULT 'HOMOLOGACAO',
    "autoEmitOnApproval" BOOLEAN NOT NULL DEFAULT false,
    "nfeSerie" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_settings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "fiscal"."fiscal_invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "focusRef" TEXT NOT NULL,
    "status" "fiscal"."FiscalInvoiceStatus" NOT NULL DEFAULT 'PENDENTE',
    "environment" "fiscal"."FiscalEnvironment" NOT NULL,
    "destNome" TEXT NOT NULL,
    "destDocumento" TEXT NOT NULL,
    "destEndereco" JSONB NOT NULL,
    "destTelefone" TEXT,
    "nfeNumber" TEXT,
    "nfeSeries" TEXT,
    "accessKey" TEXT,
    "xmlUrl" TEXT,
    "danfeUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "cancelReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorizedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_invoices_focusRef_key" ON "fiscal"."fiscal_invoices"("focusRef");

-- CreateIndex
CREATE INDEX "fiscal_invoices_tenantId_orderId_idx" ON "fiscal"."fiscal_invoices"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "fiscal_invoices_tenantId_status_idx" ON "fiscal"."fiscal_invoices"("tenantId", "status");
