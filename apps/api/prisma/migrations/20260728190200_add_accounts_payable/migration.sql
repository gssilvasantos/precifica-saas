-- CreateEnum
CREATE TYPE "financial_intelligence"."AccountsPayableOccurrence" AS ENUM ('UNICA', 'SEMANAL', 'MENSAL', 'TRIMESTRAL', 'PARCELADA');

-- CreateEnum
CREATE TYPE "financial_intelligence"."AccountsPayableStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "tagging"."TaggableEntityType" ADD VALUE 'ACCOUNTS_PAYABLE';

-- CreateTable
CREATE TABLE "financial_intelligence"."accounts_payable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "financial_intelligence"."AccountsPayableStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT NOT NULL,
    "category" TEXT,
    "supplierId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "occurrence" "financial_intelligence"."AccountsPayableOccurrence" NOT NULL DEFAULT 'UNICA',
    "installmentGroupId" TEXT,
    "installmentNumber" INTEGER,
    "totalInstallments" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_status_dueDate_idx" ON "financial_intelligence"."accounts_payable"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "accounts_payable_tenantId_installmentGroupId_idx" ON "financial_intelligence"."accounts_payable"("tenantId", "installmentGroupId");
