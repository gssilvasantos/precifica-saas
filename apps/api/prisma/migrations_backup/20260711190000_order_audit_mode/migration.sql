-- Modo de Demonstração / Audit Mode — adiciona orders.orders."isDemo".
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão das migrações anteriores):
-- este ambiente de sandbox não tem acesso a um Postgres real nem consegue
-- baixar os binários de engine do Prisma (rede bloqueada), então não é
-- possível executar `npx prisma migrate dev` interativamente aqui. Este
-- arquivo foi escrito à mão para refletir exatamente o diff que o Prisma
-- geraria entre a última migração aplicada
-- (20260711180000_mercado_livre_connection) e o schema.prisma atual.
--
-- DEFAULT false garante que toda linha existente continua sendo tratada
-- como pedido REAL sem exigir backfill — nenhum pedido pré-existente muda
-- de comportamento em nenhuma query.

ALTER TABLE "orders"."orders" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "orders_tenantId_isDemo_idx" ON "orders"."orders"("tenantId", "isDemo");
