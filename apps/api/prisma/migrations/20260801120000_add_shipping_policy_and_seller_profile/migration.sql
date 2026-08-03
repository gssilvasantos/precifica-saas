-- Modelo de taxa multi-marketplace — política de frete e perfil do vendedor
-- (01/08/2026, ver docs/marketplace-fee-model-architecture.md).
--
-- Duas mudanças, ambas ADITIVAS (nenhuma coluna removida, nenhum dado
-- reescrito):
--
-- 1. warehouses.estimatedFreightCost — frete médio estimado por canal.
--    Separado de logisticsCostPerUnit de propósito: aquele é custo interno
--    que o vendedor paga sempre (embalagem + operação de armazém); este só
--    vira custo quando a política do canal transfere o frete ao vendedor
--    (no Mercado Livre, acima de R$79). Somar os dois num campo só apagaria
--    esse degrau, que é justamente o que o motor de preço precisa enxergar.
--    Default 0 pelo mesmo racional de logisticsCostPerUnit: enquanto
--    ninguém preencher, o motor não soma frete nenhum — nunca um valor
--    arbitrário.
--
-- 2. channel_seller_profiles — o que ESTE vendedor contratou em cada canal,
--    distinto de marketplace_rules, que descreve como o CANAL cobra de todo
--    mundo. A tabela de comissão da Amazon é a mesma para todos, mas quem
--    assina o "Plano de vendas profissional" (R$19/mês) não paga a tarifa
--    de R$2 por item; a política de frete do Mercado Livre é uma só, mas o
--    desconto varia por reputação da conta (até 70%).
--
--    Sem esta tabela, a única saída seria criar uma marketplace_rules por
--    tenant só para registrar uma configuração de cadastro — poluindo o
--    versionamento de regras, que existe para rastrear mudanças do CANAL.

-- AlterTable
ALTER TABLE "logistics_fulfillment"."warehouses"
  ADD COLUMN IF NOT EXISTS "estimatedFreightCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "marketplace_intelligence"."channel_seller_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelCode" TEXT NOT NULL,
    "professionalPlanActive" BOOLEAN NOT NULL DEFAULT false,
    "freightDiscountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "channel_seller_profiles_tenantId_channelCode_key"
  ON "marketplace_intelligence"."channel_seller_profiles"("tenantId", "channelCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "channel_seller_profiles_tenantId_idx"
  ON "marketplace_intelligence"."channel_seller_profiles"("tenantId");
