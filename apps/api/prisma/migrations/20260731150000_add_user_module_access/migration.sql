-- Painel de Equipe (30/07/2026, pedido do usuário) — User.moduleAccess guarda
-- quais módulos (ORDERS/ADS/CATALOG/PROMOTIONS/FINANCE/REPLENISHMENT/
-- CONFERENCE/INTEGRATIONS/FISCAL_SETTINGS — ver
-- shared/access-control/module-code.ts) um colaborador PRICING_EDITOR/VIEWER
-- pode acessar; ADMIN sempre tem acesso total, independente deste campo.
--
-- Backfill: todo usuário que já existe hoje recebe TODOS os módulos, senão
-- ficaria travado fora do próprio sistema no primeiro login pós-migração
-- (moduleAccess vazio bloquearia tudo pra quem não é ADMIN).

ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "moduleAccess" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "identity"."users"
SET "moduleAccess" = ARRAY['ORDERS','ADS','CATALOG','PROMOTIONS','FINANCE','REPLENISHMENT','CONFERENCE','INTEGRATIONS','FISCAL_SETTINGS']
WHERE "moduleAccess" = '{}';
