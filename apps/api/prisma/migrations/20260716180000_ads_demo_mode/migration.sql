-- Modo de Demonstração / Audit Mode no módulo de Ads (Bloco 1 do sprint de
-- Layout/UI — dashboard de Ads precisa de dados fictícios realistas para as
-- auditorias de segurança da Amazon/Shopee, mesmo racional de Order.isDemo,
-- ver docs/audit-mode.md). Só AdsCampaign carrega isDemo — AdsMetricSnapshot
-- e AdsActionSuggestion são filhos (via campaignId) e são filtrados por
-- dataMode transitivamente via join com a campanha-pai, nunca com o próprio
-- campo replicado neles.
--
-- AVISO DE HONESTIDADE (mesmo padrão de toda migração manual deste
-- projeto): sandbox sem acesso a Postgres real nem aos binários de engine do
-- Prisma (rede bloqueada) — não é possível rodar `npx prisma migrate dev`
-- aqui. Este arquivo foi escrito à mão para refletir exatamente o diff que o
-- Prisma geraria entre a migração anterior (20260716160000_map_price_governance)
-- e o schema.prisma atual. Precisa ser aplicado com `npx prisma migrate deploy`
-- a partir de uma máquina/pipeline com rede real.

ALTER TABLE "marketplace_ads"."ads_campaigns" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ads_campaigns_tenantId_isDemo_idx" ON "marketplace_ads"."ads_campaigns"("tenantId", "isDemo");
