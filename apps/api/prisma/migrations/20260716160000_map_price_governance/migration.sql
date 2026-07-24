-- Módulo de Política de Preço Mínimo (MAP) — 2 mudanças independentes no
-- mesmo arquivo, pequenas o suficiente para não justificar 2 migrações
-- separadas:
--
-- 1. Product.mapPrice — piso definido pelo fornecedor/marca, nullable (ver
--    comentário no schema.prisma: null = "sem restrição MAP para este SKU").
-- 2. ProductAuditLog — trilha de auditoria de campos de governança do
--    Product (hoje só mapPrice) — mecanismo NOVO, não existia nenhum
--    equivalente genérico antes desta migração (ver comentário no
--    schema.prisma acima do model).
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão de todas as migrações
-- manuais deste projeto): este ambiente de sandbox não tem acesso a um
-- Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada), então não é possível executar `npx prisma migrate dev`
-- interativamente aqui. Este arquivo foi escrito à mão para refletir
-- exatamente o diff que o Prisma geraria entre a migração anterior
-- (20260716140000_ads_ai_optimization) e o schema.prisma atual. Precisa
-- ser aplicado com `npx prisma migrate deploy` a partir de uma
-- máquina/pipeline com rede real (mesmo caminho já usado no deploy — ver
-- docs/deploy-render-supabase-r2.md).

ALTER TABLE "catalog"."products" ADD COLUMN "mapPrice" DECIMAL(12,2);

CREATE TYPE "catalog"."ProductAuditSource" AS ENUM ('MANUAL', 'BULK_IMPORT');

CREATE TABLE "catalog"."product_audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "catalog"."ProductAuditSource" NOT NULL,
    "changedByUserId" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_audit_logs_tenantId_productId_changedAt_idx" ON "catalog"."product_audit_logs"("tenantId", "productId", "changedAt");

CREATE INDEX "product_audit_logs_tenantId_field_changedAt_idx" ON "catalog"."product_audit_logs"("tenantId", "field", "changedAt");
