-- ============================================================================
-- RLS — criação do role de runtime da aplicação (sem BYPASSRLS)
-- ============================================================================
-- Contexto (achado durante a validação empírica do RLS, via test-rls.ts):
-- o teste cruzado Tenant B lendo dado do Tenant A NÃO foi bloqueado mesmo com
-- ENABLE + FORCE ROW LEVEL SECURITY já aplicados em todas as tabelas
-- (2026-07-17_enable_row_level_security.sql). A causa não é a policy nem o
-- FORCE — é o role usado em DATABASE_URL/DIRECT_URL hoje (`postgres` /
-- `postgres.[project-ref]`).
--
-- Por que FORCE não resolveu: FORCE ROW LEVEL SECURITY só force a aplicação
-- da RLS para o DONO da tabela. Ele NÃO tem efeito sobre um role com o
-- atributo BYPASSRLS (ou superuser) — esse tipo de role ignora RLS
-- incondicionalmente, FORCE ligado ou não. O role `postgres` do Supabase é
-- criado com privilégios administrativos amplos e, na prática, tem esse
-- comportamento de bypass (é o mesmo motivo pelo qual o SQL Editor do painel
-- Supabase, que roda como `postgres`, também ignora RLS ao consultar
-- qualquer tabela). Ou seja: com a aplicação toda conectando via esse role,
-- a RLS nunca teve efeito protetivo real em produção até este arquivo ser
-- aplicado — o bug não estava na migração de RLS em si.
--
-- Fix: criar um role de aplicação SEM BYPASSRLS, com só os privilégios de
-- CRUD necessários (não é dono de nenhuma tabela, não pode alterar schema),
-- e trocar a DATABASE_URL de runtime (a que a aplicação usa a cada
-- request/query) para esse role. DIRECT_URL continua com o role `postgres`
-- — migrações (DDL) continuam precisando de privilégio administrativo, e
-- rodar `prisma migrate` não é uma operação sujeita a RLS de qualquer forma.
--
-- Aplicação (via SQL Editor do Supabase, ou psql "$DIRECT_URL" -f este
-- arquivo — precisa ser executado pelo role `postgres`, já que CREATE ROLE
-- exige privilégio administrativo):
--
--   psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-22_create_app_runtime_role.sql
--
-- LEMBRETE: depois de rodar isto e configurar a senha real (ver linha com
-- CREATE ROLE abaixo — trocar 'TROCAR_ESTA_SENHA' por uma senha forte antes
-- de rodar), é preciso:
--   1. Pegar a connection string do pooler para o novo role (mesmo host e
--      porta 6543 já usados hoje, só troca o usuário de
--      "postgres.[project-ref]" para "app_runtime.[project-ref]").
--   2. Atualizar SÓ a variável DATABASE_URL no Render (nunca DIRECT_URL) com
--      essa nova connection string.
--   3. Reiniciar/redeploy o serviço `kyneti-api` no Render para a mudança de
--      env var surtir efeito.
--   4. Rodar test-rls.ts de novo (localmente, com o .env local apontando
--      DATABASE_URL para este novo role) para confirmar que agora SIM o
--      acesso cruzado é bloqueado.
-- ============================================================================

-- Role de runtime: sem BYPASSRLS, sem SUPERUSER, sem privilégio de criar
-- banco/role/schema — só pode logar e fazer CRUD nas tabelas que
-- explicitamente conceder abaixo.
CREATE ROLE app_runtime WITH
  LOGIN
  PASSWORD 'TROCAR_ESTA_SENHA'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS
  NOREPLICATION;

GRANT CONNECT ON DATABASE postgres TO app_runtime;

-- USAGE em cada um dos 13 schemas do projeto — sem isso o role nem enxerga
-- que as tabelas existem, mesmo com GRANT de tabela concedido depois.
GRANT USAGE ON SCHEMA
  identity,
  catalog,
  logistics_intelligence,
  marketplace_intelligence,
  integration_ops,
  erp_integration,
  channel_integration,
  competition_intelligence,
  financial_intelligence,
  orders,
  logistics_fulfillment,
  promotion_intelligence,
  marketplace_ads
TO app_runtime;

-- CRUD (sem DDL, sem DROP/TRUNCATE) em todas as tabelas já existentes em
-- cada schema. Nenhuma tabela do projeto usa coluna autoincrement (todos os
-- IDs são UUID gerados pela aplicação via Prisma @default(uuid())), então
-- não há sequences para conceder aqui.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA logistics_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketplace_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA integration_ops TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA erp_integration TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA channel_integration TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA competition_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA financial_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orders TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA logistics_fulfillment TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA promotion_intelligence TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketplace_ads TO app_runtime;

-- Garante que TABELAS FUTURAS (criadas por migrations rodadas pelo role
-- `postgres`, dono de tudo) já nasçam com o grant certo para app_runtime,
-- sem precisar lembrar de repetir este script a cada nova migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA identity GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalog GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA logistics_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA integration_ops GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_integration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA channel_integration GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA competition_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA financial_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA orders GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA logistics_fulfillment GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA promotion_intelligence GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace_ads GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

-- ============================================================================
-- Fim. Depois de rodar isto: trocar a senha acima por uma real ANTES de
-- executar, atualizar DATABASE_URL no Render (só essa, não DIRECT_URL) e
-- reiniciar o serviço. Sem isso, a aplicação continua conectando como
-- `postgres` e a RLS continua sem efeito nenhum, mesmo com todas as policies
-- corretas no lugar.
-- ============================================================================
