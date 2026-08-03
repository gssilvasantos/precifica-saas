# docs/database

Modelo de dados, migrations e isolamento entre tenants.

## Onde está o quê

| Assunto | Local |
|---|---|
| Schema (fonte da verdade) | `apps/api/prisma/schema.prisma` — Prisma multiSchema, um schema Postgres por bounded context |
| Migrations versionadas | `apps/api/prisma/migrations/` |
| **Políticas de RLS e grants** | `apps/api/prisma/manual-migrations/` — SQL aplicado à mão |
| Racional do isolamento | `../row-level-security-architecture.md` |
| Estratégia de dados por contexto | `../platform-architecture.md`, seção 6 |
| Deploy e migração para Supabase | `../deploy-render-supabase-r2.md`, seção 2 |

## Regra crítica deste projeto

**RLS não é automática.** Toda tabela nova exige o par correspondente em `manual-migrations/`:

```
apply_<contexto>_rls_only.sql      políticas de linha por tenant
grant_app_runtime_<contexto>.sql   GRANTs do papel app_runtime
```

Sem esse par, o dado fica inacessível em produção — ou, pior, acessível a outra conta.
Já houve um gap real corrigido em `product_lots`. O hook `.claude/hooks/migration-notice.mjs`
lembra disso automaticamente ao editar o schema ou uma migration.

## Convenções para documentos desta pasta

- Documento de modelagem de um domínio: template `domain-model.md` da skill.
- Plano de migration arriscada (destrutiva, com backfill, ou em tabela grande): documente **antes**
  de executar, com rollback declarado.
- Toda operação destrutiva (`DROP`, `RENAME`, mudança de tipo, `SET NOT NULL`, `TRUNCATE`) exige
  confirmação explícita do usuário e segue expand → migrate → contract.

## Índice

*(vazio — o primeiro documento de banco entra aqui)*
