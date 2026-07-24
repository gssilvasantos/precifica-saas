# Row-Level Security (RLS) — desenho técnico + implementação

Status: **migração aplicada e isolamento cross-tenant validado empiricamente contra o Postgres real (Supabase); falta só apontar o serviço em produção (Render) para o role correto.** Achado importante durante a validação: `ENABLE`/`FORCE ROW LEVEL SECURITY` sozinhos não bastam quando a conexão usa o role `postgres` do Supabase — esse role tem privilégios equivalentes a `BYPASSRLS`, que ignora RLS incondicionalmente, independente de `FORCE` (ver seção 3.4.1, nova). Corrigido com um role de aplicação dedicado, `app_runtime` (sem `BYPASSRLS`, sem superuser, só CRUD nos 13 schemas — `apps/api/prisma/manual-migrations/2026-07-22_create_app_runtime_role.sql`). Teste cruzado real (Tenant B autenticado tentando ler registro do Tenant A por ID direto, via `apps/api/test-rls.ts`) confirmou bloqueio (`SUCESSO ABSOLUTO!`, 0 linhas) rodando com `app_runtime`. **Pendente**: o serviço `kyneti-api` no Render ainda conecta com `DATABASE_URL` do role `postgres` (bypass) — só o `.env` local foi trocado até agora. Prioridade #1 do usuário: reforçar a fundação de isolamento multi-tenant antes de qualquer funcionalidade nova (Ads Fase 0 e novos canais ficam em standby até isto fechar).

## 0. O que já existe, o que falta (checklist de aplicação)

**Implementado (código, revisado, não testado contra Postgres real — ver seção 7):**
- [x] `shared/prisma/tenant-context.ts` — `TenantContextStore` (`AsyncLocalStorage`).
- [x] `shared/prisma/prisma.service.ts` + `shared/prisma/prisma.module.ts` — `PrismaService` como token de tipo; client real (`buildTenantAwareClient`) provido via `{ provide: PrismaService, useValue: ... }`, sem tocar os 32 repositórios que já injetam `PrismaService`.
- [x] `shared/prisma/tenant-context.interceptor.ts` + wiring global em `main.ts`.
- [x] Bypass mínimo aplicado nos 8 schedulers `@Cron` (envelope externo em `runAsService`) — Ads Sync, Ads AI Optimization, Orders Sync, Competition Monitor, Nuvemshop Sync, Erp Sync, Video Retention Cleanup, Marketplace Intelligence Sync.
- [x] Bypass + reabertura de contexto por tenant nos 4 orquestradores que de fato iteram tenant a tenant: `AdsSyncOrchestrator.syncProvider`, `AdsAiOptimizationService.runAll`, `OrderSyncOrchestrator.syncProvider`, `RuleSyncOrchestrator.syncFeeRules` (este último com o caso especial de `tenantId` nulo = regra global, tratado com `runAsService` em vez de `run(tenantId, ...)`).
- [x] Migração SQL hand-written: `apps/api/prisma/manual-migrations/2026-07-17_enable_row_level_security.sql` (ida) e `2026-07-17_rollback_row_level_security.sql` (volta) — **fora** da pasta `prisma/migrations/` de propósito, para não ser pega automaticamente por um futuro `prisma migrate deploy` sem passar pelo teste em staging.
- [x] Suíte de testes unitários rodada (fora deste sandbox, ambiente com rede) contra o código novo — **466/466 passando** (58 test suites). Cobre `TenantContextStore`, o wiring de `PrismaService`/`PrismaModule`, o interceptor, e os schedulers/orquestradores tocados nesta frente.
- [x] `npx tsc --noEmit` em `apps/api` — **zero erros de tipagem/compilação**, rodado contra o ambiente real já com rede (não este sandbox).

**Deliberadamente deixado como bypass só no envelope externo, sem reabertura por tenant ainda (hardening não-bloqueante, documentado em comentário no próprio código de cada um):**
- [ ] `CompetitionMonitorOrchestrator.runAll()`
- [ ] `NuvemshopChannelListingSyncService.syncAllTenants()`
- [ ] `ErpSyncOrchestrator.syncAllTenants()`

**Validado contra o Postgres real (Supabase, o único ambiente que existe — não há staging separado):**
- [x] Migração `2026-07-17_enable_row_level_security.sql` aplicada (ENABLE+FORCE+policies nas 30 tabelas).
- [x] Role `app_runtime` criado (`2026-07-22_create_app_runtime_role.sql`) — sem `BYPASSRLS`, sem superuser, só CRUD nos 13 schemas via GRANT + `ALTER DEFAULT PRIVILEGES` para tabelas futuras.
- [x] Teste manual do "dono da tabela"/isolamento cruzado (seção 3.4.1): Tenant B autenticado tentando ler registro do Tenant A pelo ID direto, via `apps/api/test-rls.ts` rodando com `app_runtime` — **bloqueado corretamente, 0 linhas retornadas**.

**Pendente:**
- [ ] Apontar `DATABASE_URL` do serviço `kyneti-api` no Render para o role `app_runtime` (hoje ainda usa `postgres`, ou seja, a RLS ainda não protege nada em produção de fato — só localmente já foi validada). `DIRECT_URL` continua com `postgres` (migrações precisam de privilégio administrativo).
- [ ] Smoke test pós-troca: login + dashboard + fluxos principais funcionando normalmente com `app_runtime` (grants cobrem SELECT/INSERT/UPDATE/DELETE nos 13 schemas; qualquer tabela esquecida apareceria como erro de permissão).
- [ ] Rodar as 2 suítes E2E do Pick & Pack contra o banco já com RLS ativa e `app_runtime` em uso — cobertura de integração adicional além do teste manual acima.
- [ ] Medir latência antes/depois nos endpoints de maior volume (sync de pedidos, DRE).

## 0.1 Correção em relação ao desenho original: o banco é multi-schema

Descoberta só durante a escrita da migração SQL (não estava no desenho original acima nem no inventário da seção 4): `schema.prisma` organiza as ~37 tabelas em **13 schemas Postgres diferentes** via `@@schema(...)` (Prisma multiSchema), não um único schema `public`. Cada tabela citada na seção 4 abaixo precisa ser referenciada com o schema certo (`"catalog"."products"`, `"orders"."orders"`, etc.) — usar só o nome da tabela sem qualificar o schema teria feito a migração inteira falhar (ou, pior, silenciosamente atingir a tabela errada se por acaso existisse uma tabela de mesmo nome em `public`). A migração em `manual-migrations/` já está corrigida para isso; o inventário da seção 4 abaixo permanece como referência de quais tabelas recebem RLS, mas os nomes de schema exatos estão só no arquivo SQL.

## 1. Por que RLS, dado que o isolamento por tenant já existe

Hoje o isolamento entre contas é feito inteiramente na camada de aplicação: toda tabela de negócio tem uma coluna `tenantId`, e todo método de repositório recebe `tenantId` como parâmetro e filtra por ele manualmente (`WHERE "tenantId" = $1`, sempre escrito à mão em cada repositório Prisma). Isso funciona, mas tem uma única superfície de falha: se **um único método de um único repositório**, em qualquer um dos ~30 módulos, esquecer o filtro `tenantId` — por erro humano, por um `include`/relação mal desenhada, ou por um refactor futuro — o resultado é vazamento de dados entre contas de clientes diferentes, sem que nada no banco reclame.

RLS move essa garantia para dentro do Postgres: mesmo que a aplicação esqueça o filtro, o banco simplesmente não devolve linhas de outro tenant. É o mesmo racional de "defesa em profundidade" já usado neste projeto para o piso de preço (MAP: 3 camadas independentes) e para o piso financeiro (Etapa 13) — RLS não substitui o filtro na aplicação, ele é a camada de baixo que pega o que a camada de cima deixar passar.

## 2. A armadilha real deste ambiente: PgBouncer em modo Transaction

Confirmado em `docs/deploy-render-supabase-r2.md` (seção 2.1) e em `.env.example`: a aplicação em produção conecta no Supabase via **pooler PgBouncer em modo Transaction, porta 6543** (`DATABASE_URL=...pooler.supabase.com:6543/...?pgbouncer=true`). `DIRECT_URL` (porta 5432, conexão direta) é usada só por `prisma migrate`.

Isso importa muito para RLS porque, em modo Transaction, o pooler devolve a conexão física ao pool **assim que a transação termina** — e a próxima transação (de qualquer request, de qualquer tenant) pode pegar essa MESMA conexão física de volta. Duas consequências:

- Um `SET app.current_tenant_id = '...'` feito fora de uma transação (session-level) **vaza para o próximo tenant que cair naquela mesma conexão física**. Isso não é uma falha teórica rara — é o comportamento documentado do PgBouncer em modo Transaction, e é exatamente o tipo de bug que RLS deveria estar prevenindo, não causando.
- A forma segura é `set_config('app.current_tenant_id', $1, true)` — o terceiro argumento `true` é `is_local`, equivalente a `SET LOCAL` — chamado **dentro da mesma transação** que executa a query de negócio. `SET LOCAL` só vale até o fim da transação corrente, então não sobrevive para vazar.

Confirmei esse padrão contra a documentação oficial da Prisma (exemplo oficial do time Prisma para RLS multi-tenant, `github.com/prisma/prisma-client-extensions/row-level-security`) e contra a documentação da Supabase sobre PgBouncer/Supavisor em modo Transaction — ambas convergem no mesmo mecanismo. Fontes ao final deste documento.

## 3. Mecanismo proposto

### 3.1 Prisma Client Extension (uma única extensão global, não uma por request)

O exemplo oficial da Prisma cria um client "estendido" NOVO a cada request (`prisma.$extends(forTenant(tenantId))`). Não precisamos disso aqui: como já temos `AsyncLocalStorage` disponível no Node, a extensão pode ler o `tenantId` do contexto ambiente **dentro do próprio hook**, em vez de precisar recebê-lo como parâmetro de fábrica. Isso significa **uma única extensão aplicada uma vez no bootstrap do `PrismaService`**, sem overhead de criar um client novo por request.

```ts
// shared/prisma/tenant-context.ts (novo)
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantContext {
  tenantId: string | null; // null = bypass explícito (jobs internos)
}

const storage = new AsyncLocalStorage<TenantContext>();

export const TenantContextStore = {
  run<T>(tenantId: string, fn: () => T): T {
    return storage.run({ tenantId }, fn);
  },
  runAsService<T>(fn: () => T): T {
    // Uso restrito: só para o passo de DESCOBERTA de tenants dentro de um
    // job (ex.: "quais tenants têm conexão Mercado Livre ativa?"). O
    // trabalho por-tenant que vem depois deve voltar a usar run(tenantId, ...).
    return storage.run({ tenantId: null }, fn);
  },
  getTenantId(): string | null | undefined {
    return storage.getStore()?.tenantId;
  },
};
```

```ts
// shared/prisma/prisma.service.ts (estendido)
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextStore } from './tenant-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    return this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const tenantId = TenantContextStore.getTenantId();
            if (tenantId === undefined) {
              // Nenhum contexto definido — provavelmente um caminho de
              // código que ainda não passou pelo interceptor (ex.: script
              // de seed, teste). Falha alto e explícito em vez de rodar
              // sem RLS silenciosamente.
              throw new Error('Consulta ao Prisma sem contexto de tenant definido (TenantContextStore).');
            }
            const [, result] = await this.$transaction([
              tenantId === null
                ? this.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`
                : this.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
              query(args),
            ]);
            return result;
          },
        },
      },
    }) as unknown as PrismaService; // ver nota de tipagem abaixo
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Nota de tipagem: `$extends` retorna um tipo novo (`DynamicClientExtensionThis<...>`), não `PrismaService`. Isso é um problema conhecido de quem tenta injetar um client estendido via classe do NestJS (o padrão oficial da Prisma para Nest é expor o client estendido como um `Provider` com um token próprio, não fazer `extends PrismaClient`). Vamos precisar resolver isso na implementação real — provavelmente trocando `PrismaService` de "classe que estende `PrismaClient`" para "classe que injeta um `PrismaClient` interno e expõe os métodos via um provider `PRISMA_CLIENT` tipado como o client estendido". Não é bloqueante para o desenho, mas é trabalho real de plumbing que search não resolve sozinho — fica para a fase de implementação.

### 3.2 De onde vem o tenantId: interceptor global, não guard

`JwtAuthGuard` (Passport) já popula `request.user` com `{ id, tenantId, role }` antes dos interceptors rodarem (ordem do NestJS: guards → interceptors → handler). O ponto certo para abrir o `AsyncLocalStorage` é um **interceptor global**, não o guard em si (guard não tem acesso simples ao "resto do pipeline" como `next.handle()`):

```ts
// shared/prisma/tenant-context.interceptor.ts (novo)
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const tenantId = req.user?.tenantId;
    if (!tenantId) return next.handle(); // rota pública (ex.: /login) — sem contexto, PrismaService vai reclamar se algo tentar consultar
    return new Observable((subscriber) => {
      TenantContextStore.run(tenantId, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
```

Registrado globalmente em `main.ts` (`app.useGlobalInterceptors(...)`), depois do `JwtAuthGuard` já estar ativo.

### 3.3 Jobs internos (schedulers, webhooks) — bypass mínimo, nunca total

Os crons (`AdsSyncSchedulerJob` a cada 2h, `AdsAiOptimizationSchedulerJob` diário, e os equivalentes de Nuvemshop/Mercado Livre/reconciliação) não têm um `request` HTTP — não passam pelo interceptor acima. Cada um deles hoje faz algo como "para cada tenant com conexão ativa, sincroniza". A tentação óbvia é envolver o job inteiro em `bypass_rls`, mas isso jogaria fora a defesa em profundidade justamente no código que mexe com todos os tenants de uma vez — exatamente onde um bug de escopo é mais caro.

Padrão proposto: bypass **só** na query de descoberta (quem eu preciso processar), e `TenantContextStore.run(tenant.id, ...)` de volta para cada iteração de trabalho real:

```ts
async syncAll() {
  const tenants = await TenantContextStore.runAsService(() =>
    this.connections.findAllWithActiveConnection(), // única query em bypass
  );
  for (const tenant of tenants) {
    await TenantContextStore.run(tenant.id, () => this.syncOneTenant(tenant.id));
  }
}
```

Isso precisa ser aplicado manualmente em cada scheduler/listener que hoje itera tenants — é o item de maior volume de trabalho da implementação (mais do que a migração SQL em si).

### 3.4 A armadilha do "dono da tabela" — precisa ser verificada empiricamente, não presumida

Regra do Postgres, não deste projeto: **RLS não se aplica ao dono da tabela por padrão**, nem a roles com o atributo `BYPASSRLS`. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` faz as policies valerem mesmo para o dono (mas ainda não para superuser/BYPASSRLS).

O role usado em `DATABASE_URL` (`postgres.[ref]`) no Supabase é o role que roda as migrações — ou seja, muito provavelmente é o **dono** de todas as tabelas. Sem `FORCE ROW LEVEL SECURITY` em cada tabela, as policies seriam escritas, ativadas, e **silenciosamente ignoradas** para a própria aplicação — o pior resultado possível, porque tudo pareceria estar funcionando (a aplicação continua funcionando normalmente) sem estar oferecendo proteção nenhuma.

Duas coisas precisam ser confirmadas antes de considerar isto pronto:
1. Toda tabela recebe `FORCE ROW LEVEL SECURITY`, não só `ENABLE ROW LEVEL SECURITY`. **Feito** — ver `2026-07-17_enable_row_level_security.sql`.
2. Teste manual: autenticar como tenant A, tentar ler um registro do tenant B pelo ID direto — se voltar vazio, RLS está ativa de verdade; se voltar o registro, alguma coisa ainda está bypassando. **Feito, e na primeira tentativa DEU FALHA** — ver seção 3.4.1 abaixo para o motivo real (não era o `FORCE`, era o role da conexão).

### 3.4.1 O achado real: `FORCE` não cobre `BYPASSRLS` — e o role `postgres` do Supabase tem esse atributo

A primeira rodada do teste cruzado (Tenant B autenticado tentando ler um registro do Tenant A por ID direto, script `apps/api/test-rls.ts`) **falhou**: o registro do Tenant A voltou normalmente, mesmo com `ENABLE`+`FORCE ROW LEVEL SECURITY` já aplicados em todas as tabelas.

Causa: `FORCE ROW LEVEL SECURITY` só resolve o caso do **dono da tabela** (seção 3.4 acima). Existe uma segunda camada de bypass, independente de `FORCE`: qualquer role com o atributo **`BYPASSRLS`** (ou superusuário) ignora RLS **incondicionalmente**. O role padrão do Supabase (`postgres` / `postgres.[project-ref]`, usado em `DATABASE_URL`/`DIRECT_URL` desde o início do projeto) tem privilégios administrativos equivalentes a isso — é o mesmo motivo pelo qual o próprio SQL Editor do painel Supabase, que roda como `postgres`, também ignora RLS ao consultar qualquer tabela.

Ou seja: com a aplicação inteira conectando via esse role, a RLS nunca teve efeito protetivo real, independente de qualquer policy estar certa. Não era um bug na migração.

**Correção**: `apps/api/prisma/manual-migrations/2026-07-22_create_app_runtime_role.sql` cria um role de aplicação dedicado, `app_runtime` — `NOBYPASSRLS`, `NOSUPERUSER`, sem privilégio de criar banco/role/schema, só `GRANT SELECT, INSERT, UPDATE, DELETE` nos 13 schemas (mais `ALTER DEFAULT PRIVILEGES` para tabelas futuras já nascerem com o grant certo). A aplicação passa a usar esse role em `DATABASE_URL` (runtime); `DIRECT_URL` continua com `postgres` (migrações/DDL exigem privilégio administrativo e não são operação sujeita a RLS de qualquer forma).

Repetindo o teste cruzado com `app_runtime` no lugar de `postgres`: **bloqueado corretamente** — a query retornou 0 linhas. Essa é a confirmação real de que a RLS protege de verdade, não só "parece estar configurada certo".

## 4. Inventário de tabelas (o que recebe RLS, o que não recebe)

**Tabelas com `tenantId` direto (RLS direta — grande maioria, ~30 tabelas):** `users`, `suppliers`, `tax_profiles`, `products`, `packagings`, `packaging_usage_events`, `catalog_settings` (chave é o próprio `tenantId`), `product_audit_logs`, `logistics_settings`, `mercado_livre_connections`, `olist_connections`, `nuvemshop_connections`, `erp_sync_change_events`, `channel_listings`, `monitored_competitor_listings`, `competitor_offer_snapshots`, `competitive_opportunities`, `fixed_expenses`, `receivable_records`, `orders`, `warehouses`, `stock_movement_audit_events`, `stock_movement_audit_event_items`, `video_capture_sessions`, `stock_ledger_entries`, `promotion_campaigns`, `promotion_enrollments`, `ads_campaigns`, `ads_metric_snapshots`, `ads_action_suggestions`.

**Tabelas SEM `tenantId` próprio, escopadas por FK a uma tabela acima (RLS via subquery, não coluna direta):** `order_items` (via `orderId` → `orders.tenantId`), `stock_movement_audit_event_orders` (via `orderId`/`auditEventId`).

Exemplo de policy para este caso (mais cara que comparação direta, mas não exige mudança de schema):
```sql
CREATE POLICY tenant_isolation ON "order_items"
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR EXISTS (
    SELECT 1 FROM "orders" o
    WHERE o.id = "order_items"."orderId"
      AND o."tenantId" = current_setting('app.current_tenant_id', true)
  )
);
```

**Tabelas globais/operacionais, sem RLS (dado não pertence a nenhum tenant específico):** `tenants` (a própria tabela de contas — RLS aqui não faz sentido, é a tabela raiz), `marketplaces` (catálogo fixo de canais suportados), `marketplace_rules` (tem `tenantId?` opcional — regras globais quando nulo, por-tenant quando preenchido; **precisa de policy customizada**, não o padrão simples), `marketplace_change_events`, `provider_sync_schedules`, `provider_sync_logs`, `provider_health` (infraestrutura de sync, não dado de cliente).

`marketplace_rules` é o único caso ambíguo do schema inteiro — merece uma policy dedicada (`tenantId IS NULL OR tenantId = current_setting(...)`) em vez do padrão copiado das outras 30 tabelas.

## 5. Custo real, não hipotético

Cada operação Prisma passa a ser executada como um array-transaction de 2 statements (`set_config` + a query em si) em vez de 1 statement solto. Isso é uma viagem extra de ida-e-volta ao banco por query — não é grátis. Para os endpoints de leitura simples (a maioria do sistema) o custo é pequeno e aceitável dado o ganho de segurança; para os pontos de maior volume (sync de pedidos, DRE agregando muitas linhas) vale medir antes/depois em staging, não assumir que "é desprezível". Isso deveria ser o critério de aceite antes de ir para produção, não uma nota de rodapé.

## 6. Plano de rollout — estado atual de cada passo

1. ~~Implementar `TenantContextStore` + `TenantContextInterceptor` + reescrever `PrismaService`~~ — **feito** (seção 0).
2. ~~Passar por cada scheduler/listener que itera tenants aplicando o padrão da seção 3.3~~ — **feito** para os 8 schedulers + 4 orquestradores com loop confirmado (seção 0); 3 orquestradores restantes deliberadamente adiados como hardening não-bloqueante.
3. ~~Escrever a migração SQL (`ENABLE` + `FORCE` + policies) e o script de rollback~~ — **feito**, `apps/api/prisma/manual-migrations/`.
4. ~~Rodar a suíte de testes de unidade + `tsc --noEmit` contra o código novo~~ — **feito** (ambiente com rede, fora deste sandbox): 466/466 testes passando (58 test suites), zero erros de tipagem. **Pendente**: as 2 suítes E2E do Pick & Pack contra o banco com RLS já ativa (verificação de integração real, não coberta pelos testes unitários/tsc).
5. ~~Aplicar `2026-07-17_enable_row_level_security.sql`~~ — **feito**, contra o único Supabase existente (não há staging separado neste projeto).
6. ~~Teste manual do "dono da tabela"/isolamento cruzado (seção 3.4)~~ — **feito**, com uma volta extra: a primeira tentativa (role `postgres`) falhou por causa do `BYPASSRLS` (seção 3.4.1), corrigido criando o role `app_runtime` (`2026-07-22_create_app_runtime_role.sql`). Repetido com `app_runtime`: **bloqueou corretamente**.
7. **Pendente** — apontar `DATABASE_URL` do serviço `kyneti-api` no Render para `app_runtime` (hoje ainda é `postgres`) + smoke test (login/dashboard) + medir latência antes/depois nos endpoints de maior volume (sync de pedidos, DRE).
8. **Pendente** — depois do passo 7 confirmado: liberar de volta o toggle de Ads Fase 0/novos canais, que ficou em standby até esta frente fechar. `2026-07-17_rollback_row_level_security.sql` fica pronto como botão de desfazer em qualquer ponto.

## Fontes consultadas
- [prisma/prisma-client-extensions — row-level-security](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security) (exemplo oficial do time Prisma, `forCompany`/`bypassRLS` — mesmo padrão adaptado aqui para `forTenant`/`bypassRLS`)
- [Prisma Docs — Client extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions)
- [Prisma Docs — Configure Prisma Client with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- Documentação da Supabase sobre Supavisor/PgBouncer em modo Transaction e a exigência de `SET LOCAL`/`set_config(..., true)` dentro da mesma transação da query.
