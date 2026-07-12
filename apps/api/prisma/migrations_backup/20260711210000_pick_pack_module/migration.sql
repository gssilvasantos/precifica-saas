-- AVISO DE HONESTIDADE: esta migração foi escrita à mão, espelhando o diff
-- pretendido em prisma/schema.prisma (Sprint 27 — Pick & Pack). Não pôde ser
-- validada contra um Postgres/Prisma Engine real neste sandbox: `npx prisma
-- generate`/`migrate dev`/`validate` continuam bloqueados por rede (403 ao
-- buscar os binários do engine, mesmo com PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
-- — confirmado de novo nesta sprint). Recomendação: rodar
-- `npx prisma migrate dev` no ambiente real do usuário antes de subir esta
-- sprint, e conferir que o resultado bate com este arquivo.
--
-- Escopo: duas tabelas novas no schema logistics_fulfillment já existente
-- (nenhum schema novo é criado) — checklist de bipagem por SKU e sessão de
-- captura de vídeo em chunks, ambas ligadas ao stock_movement_audit_events
-- já existente desde a Sprint 24.

CREATE TABLE "logistics_fulfillment"."stock_movement_audit_event_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "expectedQuantity" INTEGER NOT NULL,
    "scannedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_movement_audit_event_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_movement_audit_event_items_auditEventId_skuCode_key"
    ON "logistics_fulfillment"."stock_movement_audit_event_items"("auditEventId", "skuCode");

CREATE INDEX "stock_movement_audit_event_items_tenantId_auditEventId_idx"
    ON "logistics_fulfillment"."stock_movement_audit_event_items"("tenantId", "auditEventId");

ALTER TABLE "logistics_fulfillment"."stock_movement_audit_event_items"
    ADD CONSTRAINT "stock_movement_audit_event_items_auditEventId_fkey"
    FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "logistics_fulfillment"."VideoCaptureStatus" AS ENUM ('RECORDING', 'FINALIZED');

CREATE TABLE "logistics_fulfillment"."video_capture_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "logistics_fulfillment"."VideoCaptureStatus" NOT NULL DEFAULT 'RECORDING',
    "receivedChunkCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "videoDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_capture_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_capture_sessions_auditEventId_key"
    ON "logistics_fulfillment"."video_capture_sessions"("auditEventId");

CREATE INDEX "video_capture_sessions_tenantId_status_idx"
    ON "logistics_fulfillment"."video_capture_sessions"("tenantId", "status");

CREATE INDEX "video_capture_sessions_finalizedAt_idx"
    ON "logistics_fulfillment"."video_capture_sessions"("finalizedAt");

ALTER TABLE "logistics_fulfillment"."video_capture_sessions"
    ADD CONSTRAINT "video_capture_sessions_auditEventId_fkey"
    FOREIGN KEY ("auditEventId") REFERENCES "logistics_fulfillment"."stock_movement_audit_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
