-- Etapa 19 (Orquestração de Custos) + catch-up da Etapa 17 (escalabilidade
-- multicanal).
--
-- AVISO DE HONESTIDADE / CONTEXTO: este ambiente de sandbox não tem acesso a
-- um Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada — mesma limitação documentada nas etapas anteriores), então não
-- é possível executar `npx prisma migrate dev` interativamente aqui. Este
-- arquivo foi escrito à mão para refletir EXATAMENTE o diff que o Prisma
-- geraria entre a última migração aplicada (20260711114918_financial_governance)
-- e o schema.prisma atual — incluindo os campos da Etapa 17
-- (Order.feeAmount/netAmount/fiscalResponsibility/buyerTaxId/invoiceNumber,
-- OrderItem.taxAmount) que ficaram pendentes de migração porque foram
-- adicionados ao schema.prisma no mesmo período em que o `prisma generate`
-- estava bloqueado. Isso é feito de propósito nesta migração (não só o
-- costPrice novo) para que o histórico de migrations pare de divergir do
-- schema.prisma — rodar `npx prisma migrate dev` num ambiente com banco real
-- deve encontrar ZERO diff pendente depois desta migração.
--
-- Todas as colunas novas são opcionais ou têm DEFAULT — nenhuma linha
-- existente (Order ou OrderItem) é perdida ou fica inconsistente.

-- CreateEnum
CREATE TYPE "orders"."FiscalResponsibility" AS ENUM ('SELLER', 'MARKETPLACE');

-- AlterTable: Order (Etapa 17 — normalização financeira + campos fiscais)
ALTER TABLE "orders"."orders"
  ADD COLUMN "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "fiscalResponsibility" "orders"."FiscalResponsibility" NOT NULL DEFAULT 'SELLER',
  ADD COLUMN "buyerTaxId" TEXT,
  ADD COLUMN "invoiceNumber" TEXT;

-- AlterTable: OrderItem (Etapa 17 — imposto por item; Etapa 19 — custo no momento do pedido)
ALTER TABLE "orders"."order_items"
  ADD COLUMN "taxAmount" DECIMAL(12,2),
  ADD COLUMN "costPrice" DECIMAL(12,2);
