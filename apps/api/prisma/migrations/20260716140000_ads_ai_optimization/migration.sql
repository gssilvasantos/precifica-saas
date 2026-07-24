-- Módulo de Ads multicanal, Fase 4 (sugestão via IA) — 2 mudanças
-- independentes no mesmo arquivo, pequenas o suficiente para não justificar
-- 2 migrações separadas:
--
-- 1. CatalogSettings.targetRoas — meta de ROAS por tenant, nullable (ver
--    comentário no schema.prisma: null = "tenant não configurou", resolvido
--    para DEFAULT_ROAS_HEALTHY_THRESHOLD por FinancialPolicyReaderService,
--    nunca 0 como default por causar mudança de semântica).
-- 2. AdsActionSuggestion.source/confidenceScore/metadata — permite a fila
--    de aprovação (Fase 3) receber sugestões originadas por IA, sem mudar o
--    fluxo de confirmação/aplicação (AdsActionDispatcherService inalterado).
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão de todas as migrações
-- manuais deste projeto): este ambiente de sandbox não tem acesso a um
-- Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada), então não é possível executar `npx prisma migrate dev`
-- interativamente aqui. Este arquivo foi escrito à mão para refletir
-- exatamente o diff que o Prisma geraria entre a migração anterior
-- (20260716120000_ads_action_suggestions) e o schema.prisma atual. Precisa
-- ser aplicado com `npx prisma migrate deploy` a partir de uma
-- máquina/pipeline com rede real (mesmo caminho já usado no deploy — ver
-- docs/deploy-render-supabase-r2.md).

ALTER TABLE "catalog"."catalog_settings" ADD COLUMN "targetRoas" DOUBLE PRECISION;

CREATE TYPE "marketplace_ads"."AdsActionSource" AS ENUM ('RULE_BASED', 'AI');

ALTER TABLE "marketplace_ads"."ads_action_suggestions" ADD COLUMN "source" "marketplace_ads"."AdsActionSource" NOT NULL DEFAULT 'RULE_BASED';
ALTER TABLE "marketplace_ads"."ads_action_suggestions" ADD COLUMN "confidenceScore" DOUBLE PRECISION;
ALTER TABLE "marketplace_ads"."ads_action_suggestions" ADD COLUMN "metadata" JSONB;
