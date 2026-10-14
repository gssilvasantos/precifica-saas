-- CreateTable
CREATE TABLE "competition_intelligence"."competitive_opportunity_status_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "channelCode" TEXT,
    "previousStatus" "competition_intelligence"."BuyBoxStatus",
    "newStatus" "competition_intelligence"."BuyBoxStatus" NOT NULL,
    "ourPrice" DECIMAL(12,2),
    "bestCompetitorPrice" DECIMAL(12,2) NOT NULL,
    "bestCompetitorLabel" TEXT NOT NULL,
    "priceGapPct" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitive_opportunity_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitive_opportunity_status_changes_tenantId_detectedAt_idx" ON "competition_intelligence"."competitive_opportunity_status_changes"("tenantId", "detectedAt");

-- CreateIndex
CREATE INDEX "competitive_opportunity_status_changes_tenantId_skuCode_det_idx" ON "competition_intelligence"."competitive_opportunity_status_changes"("tenantId", "skuCode", "detectedAt");

