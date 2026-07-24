-- Módulo de Ads multicanal, Fase 1 (dashboard de leitura, escopo Mercado
-- Livre) — novo schema Postgres "marketplace_ads" com 2 tabelas.
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão de todas as migrações
-- manuais deste projeto): este ambiente de sandbox não tem acesso a um
-- Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada), então não é possível executar `npx prisma migrate dev`
-- interativamente aqui. Este arquivo foi escrito à mão para refletir
-- exatamente o diff que o Prisma geraria entre o baseline aplicado em
-- produção (20260712124142_baseline_completo) e o schema.prisma atual — só
-- um schema novo com duas tabelas, nenhuma coluna alterada em tabela
-- existente. Precisa ser aplicado com `npx prisma migrate deploy` a partir
-- de uma máquina/pipeline com rede real (mesmo caminho já usado no primeiro
-- deploy — ver docs/deploy-render-supabase-r2.md).

CREATE SCHEMA IF NOT EXISTS "marketplace_ads";

CREATE TYPE "marketplace_ads"."AdsCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'UNKNOWN');

CREATE TABLE "marketplace_ads"."ads_campaigns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "externalCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "marketplace_ads"."AdsCampaignStatus" NOT NULL DEFAULT 'UNKNOWN',
    "dailyBudget" DECIMAL(12,2),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ads_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_campaigns_tenantId_channelCode_externalCampaignId_key" ON "marketplace_ads"."ads_campaigns"("tenantId", "channelCode", "externalCampaignId");

CREATE INDEX "ads_campaigns_tenantId_channelCode_idx" ON "marketplace_ads"."ads_campaigns"("tenantId", "channelCode");

CREATE TABLE "marketplace_ads"."ads_metric_snapshots" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "revenueAds" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ads_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ads_metric_snapshots_campaignId_periodDate_key" ON "marketplace_ads"."ads_metric_snapshots"("campaignId", "periodDate");

CREATE INDEX "ads_metric_snapshots_tenantId_periodDate_idx" ON "marketplace_ads"."ads_metric_snapshots"("tenantId", "periodDate");

ALTER TABLE "marketplace_ads"."ads_metric_snapshots" ADD CONSTRAINT "ads_metric_snapshots_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "marketplace_ads"."ads_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
