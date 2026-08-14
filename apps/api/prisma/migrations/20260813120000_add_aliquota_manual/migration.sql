-- Alíquota mantida à mão pelo lojista (13/08/2026).
--
-- O caso real que motivou: o lojista acompanha o próprio faturamento e mantém
-- uma alíquota um pouco ACIMA da calculada, como margem de segurança
-- deliberada. Errar imposto para cima subestima lucro no DRE e sobe o piso de
-- preço — a direção segura. Não é descuido; é política dele.
--
-- Quando preenchida, vence a calculada (source MANUAL_OVERRIDE no resolver),
-- sempre com a calculada visível ao lado para a diferença não sumir.
--
-- Aditiva e nullable. NULL significa "não sobrescrito", e é diferente de 0 —
-- zero seria uma alíquota afirmada, e faria o piso de preço ignorar imposto.
-- Por isso nullable de verdade, sem DEFAULT.
--
-- Mora nesta tabela, e não em catalog.catalog_settings, porque aqui existe
-- VIGÊNCIA: aceitar uma sugestão de reajuste abre uma linha nova em vez de
-- sobrescrever, e um DRE de mês fechado continua calculado com o número que
-- valia naquele mês.
--
-- RLS/GRANT: nenhuma ação necessária. tenant_tax_profiles já existe, já tem
-- ENABLE ROW LEVEL SECURITY, política tenant_isolation e os grants de
-- app_runtime (aplicados na migration 20260802120000_add_tax_intelligence).
-- RLS é por LINHA, não por coluna — a política existente cobre a coluna nova.
--
-- Rollback: ALTER TABLE ... DROP COLUMN "aliquotaManualPct";
-- Perde apenas o valor digitado; nenhum outro dado depende dele.

ALTER TABLE "tax_intelligence"."tenant_tax_profiles"
  ADD COLUMN IF NOT EXISTS "aliquotaManualPct" DECIMAL(5,2);
