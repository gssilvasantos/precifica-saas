-- Sprint 22 (Autenticação Real do Mercado Livre) — nova tabela
-- marketplace_intelligence.mercado_livre_connections.
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão das migrações anteriores):
-- este ambiente de sandbox não tem acesso a um Postgres real nem consegue
-- baixar os binários de engine do Prisma (rede bloqueada), então não é
-- possível executar `npx prisma migrate dev` interativamente aqui. Este
-- arquivo foi escrito à mão para refletir exatamente o diff que o Prisma
-- geraria entre a última migração aplicada
-- (20260711130000_order_cost_and_fiscal_catchup) e o schema.prisma atual —
-- só uma tabela nova, nenhuma coluna alterada em tabela existente.

CREATE TABLE "marketplace_intelligence"."mercado_livre_connections" (
    "tenantId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenType" TEXT NOT NULL DEFAULT 'bearer',
    "scope" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mercado_livre_connections_pkey" PRIMARY KEY ("tenantId")
);
