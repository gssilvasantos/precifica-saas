-- Achado de auditoria (20/10/2026, skill supabase-postgres-best-practices):
-- os dois caminhos de leitura mais frequentes de MarketplaceRule
-- (PrismaMarketplaceRuleRepository.findActiveByScope/findLatestVersion,
-- chamados por tenant a cada resolução de preço/regra) filtram por
-- {marketplaceId, ruleType, scopeKey, tenantId[, status]}. O índice antigo
-- (marketplaceId, ruleType, scopeKey, status) não tinha tenantId — o
-- Postgres achava o grupo certo de linhas e ainda precisava verificar
-- tenantId linha a linha dentro dele (incluindo as globais, tenantId NULL,
-- e as de outros tenants). tenantId entra ANTES de status porque
-- findLatestVersion (sem filtro de status) também precisa do prefixo útil.
--
-- CONCURRENTLY (ver .claude/rules/database.md, "Índice em tabela grande é
-- criado de forma concorrente"): evita lock exclusivo na tabela durante a
-- criação. Index concorrente não pode rodar dentro de uma transação — por
-- isso os dois comandos ficam fora de BEGIN/COMMIT (igual ao padrão já
-- usado nas manual-migrations de RLS deste projeto para operações que não
-- podem ser transacionais).
--
-- PENDENTE (regra de honestidade do projeto — .claude/rules/testing.md):
-- esta migration foi ESCRITA mas NÃO EXECUTADA contra nenhum banco real.
-- Este ambiente de sandbox não tem Postgres disponível (sem Docker, sem
-- DIRECT_URL de produção) — `npx prisma migrate dev`/`deploy` precisa ser
-- rodado por alguém com acesso a um banco de verdade antes de ir para
-- produção. `npx prisma generate` foi executado (não precisa de conexão) e
-- o typecheck/build do projeto passaram com o schema atualizado.
DROP INDEX CONCURRENTLY IF EXISTS "marketplace_intelligence"."marketplace_rules_marketplaceId_ruleType_scopeKey_status_idx";

CREATE INDEX CONCURRENTLY "marketplace_rules_marketplaceId_ruleType_scopeKey_tenan_idx" ON "marketplace_intelligence"."marketplace_rules"("marketplaceId", "ruleType", "scopeKey", "tenantId", "status");
