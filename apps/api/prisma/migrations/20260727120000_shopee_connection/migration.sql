-- Integração Shopee Open Platform (27/07/2026, ver README) — ShopeeConnection
-- é o análogo de MercadoLivreConnection (Sprint 22): um registro por tenant,
-- credenciais SEMPRE criptografadas em repouso (CredentialEncryptionService).
--
-- AVISO DE HONESTIDADE (mesmo padrão de toda migração manual deste
-- projeto): sandbox sem acesso a Postgres real nem aos binários de engine do
-- Prisma (rede bloqueada) — não é possível rodar `npx prisma migrate dev`
-- aqui. Este arquivo foi escrito à mão para refletir exatamente o diff que o
-- Prisma geraria entre a migração anterior (20260726120000_order_shipping_status_checked_at)
-- e o schema.prisma atual. Precisa ser aplicado com `npx prisma migrate deploy`
-- a partir de uma máquina/pipeline com rede real (já configurado como
-- Pre-Deploy Command no Render, ver docs/deploy-render-supabase-r2.md).

CREATE TABLE "marketplace_intelligence"."shopee_connections" (
    "tenantId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopee_connections_pkey" PRIMARY KEY ("tenantId")
);
