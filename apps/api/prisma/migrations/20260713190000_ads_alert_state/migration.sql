-- Módulo de Ads multicanal, Fase 2 (alertas inteligentes) — adiciona o
-- estado de alerta por campanha (lastAlertedTier/lastAlertedAt) usado pela
-- máquina de estado ALERT/RESET/NONE (domain/ads-metrics.ts,
-- determineAlertAction) para evitar tanto spam de alerta a cada sync quanto
-- silêncio permanente após o primeiro alerta.
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão de todas as migrações
-- manuais deste projeto): este ambiente de sandbox não tem acesso a um
-- Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada), então não é possível executar `npx prisma migrate dev`
-- interativamente aqui. Este arquivo foi escrito à mão para refletir
-- exatamente o diff que o Prisma geraria entre a migração anterior
-- (20260713150000_marketplace_ads) e o schema.prisma atual — um enum novo e
-- duas colunas nullable adicionadas em "ads_campaigns", nenhuma tabela nova.
-- Precisa ser aplicado com `npx prisma migrate deploy` a partir de uma
-- máquina/pipeline com rede real (mesmo caminho já usado no deploy — ver
-- docs/deploy-render-supabase-r2.md).

CREATE TYPE "marketplace_ads"."AdsCampaignHealthTier" AS ENUM ('ESTRELA', 'PONTO_DE_ATENCAO', 'CUSTO_PERDIDO', 'SEM_DADOS');

ALTER TABLE "marketplace_ads"."ads_campaigns" ADD COLUMN "lastAlertedTier" "marketplace_ads"."AdsCampaignHealthTier";
ALTER TABLE "marketplace_ads"."ads_campaigns" ADD COLUMN "lastAlertedAt" TIMESTAMP(3);
