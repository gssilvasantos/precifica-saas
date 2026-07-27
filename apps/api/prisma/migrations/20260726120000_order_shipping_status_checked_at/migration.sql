-- Reestruturação do sync do Mercado Livre (25-26/07/2026, ver README) —
-- separa a persistência rápida de pedidos (sem consulta de envio) de uma
-- varredura dedicada e resumível de enriquecimento de status de envio
-- (MercadoLivreShipmentEnrichmentJob, novo). shippingStatusCheckedAt é o
-- estado que torna essa varredura resumível SEM cursor em memória: null =
-- "ainda não conferido de verdade via GET /shipments/{id}".
--
-- AVISO DE HONESTIDADE (mesmo padrão de toda migração manual deste
-- projeto): sandbox sem acesso a Postgres real nem aos binários de engine do
-- Prisma (rede bloqueada) — não é possível rodar `npx prisma migrate dev`
-- aqui. Este arquivo foi escrito à mão para refletir exatamente o diff que o
-- Prisma geraria entre a migração anterior (20260716180000_ads_demo_mode) e
-- o schema.prisma atual. Precisa ser aplicado com `npx prisma migrate deploy`
-- a partir de uma máquina/pipeline com rede real (já configurado como
-- Pre-Deploy Command no Render, ver docs/deploy-render-supabase-r2.md).

ALTER TABLE "orders"."orders" ADD COLUMN "shippingStatusCheckedAt" TIMESTAMP(3);

CREATE INDEX "orders_tenantId_channelCode_status_shippingStatusCheckedAt_orderedAt_idx"
  ON "orders"."orders"("tenantId", "channelCode", "status", "shippingStatusCheckedAt", "orderedAt");
