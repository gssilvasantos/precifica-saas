-- Lucro Presumido e Lucro Real (02/08/2026) — ver docs/tributacao-br-regimes-e-reforma.md §1.3 e §1.4.
--
-- Aditiva e nullable: só os regimes normais usam estas colunas. No Simples o
-- ICMS já está na partilha do Anexo, e presunção não existe.
--
-- Nullable de verdade (não DEFAULT 0): zero seria um valor plausível e errado.
-- O resolver BLOQUEIA quando falta, em vez de precificar sem ICMS.

ALTER TABLE "tax_intelligence"."tenant_tax_profiles"
  ADD COLUMN IF NOT EXISTS "icmsAliquotaPct"  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "presuncaoIrpjPct" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "presuncaoCsllPct" DECIMAL(5,2);
