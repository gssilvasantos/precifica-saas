-- Benchmark Bling (29/07/2026, ver docs/bling-erp-benchmark-analysis.md,
-- seção 2) — CEST, obrigatório na NF-e de item sujeito a Substituição
-- Tributária. Nullable (nem todo produto tem ST), mesmo racional de
-- ncm/gtin/fiscalOriginCode. Idempotente (IF NOT EXISTS) seguindo o mesmo
-- padrão das migrações retroativas desta base.

ALTER TABLE "catalog"."products" ADD COLUMN IF NOT EXISTS "cest" TEXT;
