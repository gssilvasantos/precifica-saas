-- Benchmark Bling (29/07/2026, docs/bling-erp-benchmark-analysis.md, seção 2
-- — ContasBaixarContaDTO) — baixa de conta a pagar com juros/desconto/tarifa,
-- valor efetivamente pago pode diferir do valor de face. Idempotente
-- (IF NOT EXISTS), mesmo padrão das migrações retroativas desta base.

ALTER TABLE "financial_intelligence"."accounts_payable"
  ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "interestAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "feeAmount" DECIMAL(12,2);
