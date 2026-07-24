-- Módulo de Ads multicanal, Fase 3 (automação de escrita — Safety Lock) —
-- nova tabela "ads_action_suggestions" no schema "marketplace_ads": fila de
-- ações sugeridas (hoje só PAUSE_CAMPAIGN) que aguardam confirmação
-- explícita do usuário antes de qualquer chamada de escrita a um
-- marketplace. Nenhuma coluna alterada em tabela existente, exceto a nova
-- relação implícita via FK.
--
-- AVISO DE HONESTIDADE / CONTEXTO (mesmo padrão de todas as migrações
-- manuais deste projeto): este ambiente de sandbox não tem acesso a um
-- Postgres real nem consegue baixar os binários de engine do Prisma (rede
-- bloqueada), então não é possível executar `npx prisma migrate dev`
-- interativamente aqui. Este arquivo foi escrito à mão para refletir
-- exatamente o diff que o Prisma geraria entre a migração anterior
-- (20260713190000_ads_alert_state) e o schema.prisma atual. Precisa ser
-- aplicado com `npx prisma migrate deploy` a partir de uma máquina/pipeline
-- com rede real (mesmo caminho já usado no deploy — ver
-- docs/deploy-render-supabase-r2.md).

CREATE TYPE "marketplace_ads"."AdsActionType" AS ENUM ('PAUSE_CAMPAIGN');

CREATE TYPE "marketplace_ads"."AdsActionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'APPLIED', 'REJECTED', 'FAILED');

CREATE TABLE "marketplace_ads"."ads_action_suggestions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "actionType" "marketplace_ads"."AdsActionType" NOT NULL,
    "status" "marketplace_ads"."AdsActionStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "failureReason" TEXT,

    CONSTRAINT "ads_action_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ads_action_suggestions_tenantId_status_idx" ON "marketplace_ads"."ads_action_suggestions"("tenantId", "status");

CREATE INDEX "ads_action_suggestions_campaignId_actionType_status_idx" ON "marketplace_ads"."ads_action_suggestions"("campaignId", "actionType", "status");

ALTER TABLE "marketplace_ads"."ads_action_suggestions" ADD CONSTRAINT "ads_action_suggestions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "marketplace_ads"."ads_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
