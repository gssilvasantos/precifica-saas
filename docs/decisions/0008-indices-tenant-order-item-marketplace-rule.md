# ADR 0008 — Índices de tenant em OrderItem e MarketplaceRule (achado de auditoria)

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-10-20 |
| **Decisores** | Claude (agente), a pedido do usuário, a partir de achado de auditoria de performance |
| **Escopo** | módulo (orders, marketplace-intelligence) |

## Contexto

A auditoria de Postgres/RLS (skill `supabase-postgres-best-practices`, 20/10/2026) apontou
"índices faltando pros filtros de tenant" em `OrderItem` e `MarketplaceRule`. Investigação
dos dois casos, nesta correção, mostrou que eles não são o mesmo problema:

**`OrderItem` não tem coluna `tenantId` própria** — decisão de design já documentada no
código (`schema.prisma`, comentário do modelo; `manual-migrations/2026-07-17_...`, comentário
da policy de RLS): "evita desnormalizar tenantId numa tabela que já tem uma FK forte para o
dono" (`Order`). Toda leitura real inspecionada (`prisma-order.repository.ts`,
linhas ~300, ~352, ~370, ~398) filtra via `{ orderId: ..., order: { tenantId } }` — o Prisma
resolve isso como um join/EXISTS contra `orders`, que já tem `tenantId` como coluna líder em
4 índices compostos (`@@index([tenantId, status, orderedAt])` e outros). `OrderItem` já tem
`@@index([orderId])`, que cobre o lado "achar os itens deste(s) pedido(s)" do join — a outra
ponta (`orders.id`, PK) é indexada por definição. A política de RLS usa o mesmo padrão de
`EXISTS` e se beneficia dos mesmos índices.

**`MarketplaceRule.tenantId` é nullable** (null = regra global da plataforma, preenchido =
override de um tenant — caso documentado como "único caso ambíguo do schema" na policy de
RLS). O índice existente, `@@index([marketplaceId, ruleType, scopeKey, status])`, NÃO incluía
`tenantId` — mas as duas consultas mais chamadas
(`PrismaMarketplaceRuleRepository.findActiveByScope`/`findLatestVersion`, no caminho de
resolução de preço/regra, chamadas por tenant) filtram exatamente por
`{marketplaceId, ruleType, scopeKey, tenantId[, status]}`. Aqui o índice estava genuinamente
incompleto: o Postgres localizava o grupo certo de linhas (marketplace+tipo+escopo+[status])
e ainda precisava verificar `tenantId` linha a linha dentro desse grupo — incluindo as linhas
globais e as de outros tenants, que crescem com o número de tenants com override.

## Decisão

1. **`OrderItem`: nenhuma mudança de schema.** Adicionar uma coluna `tenantId` desnormalizada
   exigiria uma migration `expand → backfill → contract`, um novo campo a manter sincronizado
   com `Order.tenantId` para sempre (risco de drift), e contradiria a razão já documentada no
   próprio repositório para NÃO desnormalizar. O caminho de leitura real já é coberto pelos
   índices existentes (`OrderItem.orderId` + os índices de `Order.tenantId`). Achado revisado
   e fechado sem ação — fechar um achado de auditoria com "investigado, sem ação necessária,
   com evidência" é tão válido quanto uma correção de código.
2. **`MarketplaceRule`: índice composto estendido.** Substituído
   `@@index([marketplaceId, ruleType, scopeKey, status])` por
   `@@index([marketplaceId, ruleType, scopeKey, tenantId, status])` — `tenantId` entra ANTES
   de `status` porque `findLatestVersion` (sem filtro de status) também precisa do prefixo
   útil. Migration em `prisma/migrations/20261020150000_marketplace_rule_tenant_index/`, com
   `DROP INDEX CONCURRENTLY` + `CREATE INDEX CONCURRENTLY` (regra do projeto para índice em
   tabela que pode já ter volume).

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Desnormalizar `tenantId` em `OrderItem` (literal do achado original) | Índice direto, sem depender do join | Contradiz a razão já documentada; migration com backfill; novo campo pra manter certo em todo INSERT/UPDATE de item, inclusive nos providers de sync de cada canal | Custo e risco reais sem ganho de performance demonstrado — o caminho já existente é eficiente |
| Deixar `MarketplaceRule` como estava | Zero esforço | Achado real de performance, piora conforme crescem os overrides por tenant | Inaceitável dado o achado |

## Consequências

**Positivas**
- `MarketplaceRule`: consultas de resolução de regra (chamadas no caminho de pricing) deixam
  de examinar linha a linha dentro do grupo marketplace+tipo+escopo para achar o tenant certo.
- `OrderItem`: documentado explicitamente por que a arquitetura atual já é suficiente — evita
  que uma futura auditoria/pessoa reabra o mesmo achado sem ver esta investigação.

**Negativas / custo aceito**
- Migration do `MarketplaceRule` foi ESCRITA mas NÃO EXECUTADA contra nenhum banco real —
  este ambiente não tem Postgres disponível (sem Docker, sem `DIRECT_URL` de produção).
  `npx prisma generate` roda sem conexão e foi executado com sucesso; `npx prisma migrate
  deploy` precisa ser rodado por alguém com acesso ao Supabase de produção.
- `DROP INDEX CONCURRENTLY`/`CREATE INDEX CONCURRENTLY` não podem rodar dentro de uma
  transação — a migration já reflete isso, mas vale confirmar que o pipeline de deploy não
  envolve as duas em uma transação implícita.

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| Migration não aplicada em produção antes do próximo deploy que dependa dela | Nenhum — o índice antigo some e o novo aparece só depois de rodar a migration; sem ela, o comportamento funcional não muda, só a performance permanece como estava | Rodar `npx prisma migrate deploy` contra o Supabase de produção |
| Suposição sobre o padrão de leitura de `OrderItem` ficar errada (ex.: uma query nova filtrando por `vendedorId` sem `order.tenantId` crescer em volume) | `EXPLAIN` mostrando scan sequencial em `order_items` para essa query específica | Revisitar esta ADR com a query concreta — a decisão de não desnormalizar foi tomada para os padrões de leitura INSPECIONADOS nesta data, não como princípio absoluto |

## Reversibilidade

Alta: o índice de `MarketplaceRule` pode ser trocado de volta (`DROP`/`CREATE` do índice
antigo) sem qualquer mudança de dado. A decisão sobre `OrderItem` não cria nada para
reverter — é a ausência de uma mudança.

## Referências

- Achado original: auditoria com a skill `supabase-postgres-best-practices`, 20/10/2026.
- `prisma/manual-migrations/2026-07-17_enable_row_level_security.sql`, comentários das
  policies de `order_items` e `marketplace_rules`.
- `apps/api/src/modules/orders/infrastructure/prisma-order.repository.ts` — consultas reais
  inspecionadas.
- `apps/api/src/modules/marketplace-intelligence/infrastructure/prisma-marketplace-rule.repository.ts`
  — consultas reais inspecionadas.
