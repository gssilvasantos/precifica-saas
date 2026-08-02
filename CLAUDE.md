# CLAUDE.md — Kyneti

Contexto permanente do projeto. Leia antes de qualquer tarefa.
Instruções detalhadas moram em `.claude/skills/product-engineering-studio/`,
`.claude/rules/` e `docs/` — este arquivo é só o mapa.

---

## 1. Identidade

| | |
|---|---|
| **Produto** | **Kyneti** (`kyneti.com.br`, API em `api.kyneti.com.br`) |
| **Repositório / código legado** | `precifica-saas`, pacotes `@precifica/api` e `@precifica/web` |
| **Natureza** | SaaS multi-tenant B2B |
| **Estágio** | Demo/beta em produção — infra real (Render + Supabase + Cloudflare R2), com contas de cliente reais e integrações conectadas. Não é MVP local. |
| **Propósito (comprovado no repositório)** | Plataforma de inteligência para vendedores de marketplace: precificação/margem, pedidos multicanal, catálogo via ERP, concorrência, ads, fiscal, logística e financeiro. |
| **Público (comprovado)** | Sellers/lojistas que vendem em Mercado Livre, Shopee, Nuvemshop e operam ERP Olist/Tiny. Segmentação formal de mercado: **a definir**. |

> O nome `precifica` é **legado** de quando o produto era só um repricer. Não renomeie
> pacotes, tabelas ou chaves de `localStorage` sem uma tarefa explícita de renomeação —
> há dados em produção dependendo desses nomes.

### Módulos existentes (backend — `apps/api/src/modules/`)

`identity-access` · `catalog` · `logistics-intelligence` · `logistics-fulfillment` ·
`marketplace-intelligence` · `marketplace-publishing` · `marketplace-ads` ·
`erp-integration` · `pricing-intelligence` · `competition-intelligence` ·
`promotion-intelligence` · `financial-intelligence` · `orders` · `procurement` ·
`production` · `fiscal` · `freight-shipping` · `sellers` · `tagging`

### Módulos concedíveis por colaborador (`ModuleCode`)

`ORDERS` · `ADS` · `CATALOG` · `PROMOTIONS` · `FINANCE` · `REPLENISHMENT` ·
`CONFERENCE` · `INTEGRATIONS` · `FISCAL_SETTINGS`
→ `apps/api/src/shared/access-control/module-code.ts` (1:1 com o Sidebar do web).

### Módulos planejados

Ver roadmaps em `docs/tiny-erp-benchmark-analysis.md` e `docs/bling-erp-benchmark-analysis.md`.
Nada além do que está nesses documentos deve ser assumido como planejado.

---

## 2. Arquitetura atual (comprovada por inspeção)

```
precifica-saas/
├── apps/api/     NestJS 10 + TypeScript 5.5 (commonjs, strict)
├── apps/web/     React 18 + Vite 5 + TypeScript 5.5 + Tailwind 3
├── docs/         36 documentos de arquitetura (um por módulo) + docs/legal
└── docker-compose.yml   Postgres 16 + Redis 7 (dev local)
```

**Não é monorepo com workspaces.** Não há `package.json` na raiz; cada app instala e roda
isolado (`cd apps/api && npm install`). Os `package-lock.json` da raiz e de `apps/` são
stubs vazios. **Não existe pacote compartilhado** entre api e web.

### Backend

- **Clean Architecture por módulo**: `domain/` (puro) → `application/` (services + `ports/`) →
  `infrastructure/` (Prisma, HTTP externo) + `interface/` (controllers, DTOs, guards).
  Dependência sempre apontando para dentro.
- **`public-api.ts`** é o único ponto de import entre módulos. Módulo nunca lê tabela Prisma
  de outro módulo — só porta explícita (`shared/contracts/*.port.ts` + `tokens.ts`).
- `shared/`: `prisma/` (RLS), `contracts/` (26 portas), `sync-ops/`, `observability/`,
  `rate-limiting/` (saída para marketplaces), `security/` (AES-256-GCM de credenciais),
  `access-control/`, `config/`, `domain/`, `infrastructure/` (storage local/R2, AI).
- Global: `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` + `transform`),
  prefixo `/api`, `TenantContextInterceptor`, body limit 15 MB (chunks de vídeo).

### Banco

- PostgreSQL 16. Prisma 5.20 com **multiSchema** — um schema Postgres por bounded context
  (`identity`, `catalog`, `orders`, `fiscal`, `logistics_fulfillment`, …).
- **RLS real**: extensão do Prisma Client (`buildTenantAwareClient`) roda
  `set_config('app.current_tenant_id', …, true)` na **mesma transação** da query; contexto
  vem de `AsyncLocalStorage` (`TenantContextStore`), aberto pelo `TenantContextInterceptor`.
  Query sem contexto **lança erro** — nunca roda "no escuro". Ver `docs/row-level-security-architecture.md`.
- Políticas de RLS e `GRANT`s do papel `app_runtime` vivem em **SQL manual**:
  `apps/api/prisma/manual-migrations/`. **Todo schema/tabela novo exige o par
  `apply_*_rls_only.sql` + `grant_app_runtime_*.sql`** — este é o risco de drift nº 1 do projeto.

### Autenticação e autorização

- JWT (`@nestjs/jwt` + `passport-jwt`), payload `{ sub, tenantId, role }`; bcrypt para senha.
- E-mail é único **por tenant**, não globalmente (decisão intencional).
- Camadas de guard: `JwtAuthGuard` → `RolesGuard` (`ADMIN`/`PRICING_EDITOR`/`VIEWER`) →
  `ModuleAccessGuard` (`@RequireModule(ModuleCode.X)`) → `PlatformAdminGuard` (cross-tenant).
- Frontend guarda o token em `localStorage` sob a chave `precifica.accessToken`.

### Frontend

- React Router 6, TanStack Query 5 (server state), Context API (`auth`, `theme`, `app-mode`).
- `axios` com `baseURL: '/api'` + interceptor de Bearer (`src/lib/api-client.ts`);
  proxy do Vite em dev para `localhost:3000`.
- Tailwind 3 + `tailwindcss-animate`, dark mode por classe (`.dark`, dark é o padrão da marca),
  paleta Kyneti nomeada (`ink`/`canvas`/`surface`/`gold`/`margin`/`channel`) + tokens semânticos
  shadcn. Componentes shadcn/ui **copiados para dentro do repo** (`src/components/ui/`), não
  são dependência de runtime.
- Organização: `routes/` (páginas) · `features/<contexto>/` (`api.ts` + `components/`) ·
  `components/ui/` (design system) · `lib/`.
- **Não há biblioteca de animação além de `tailwindcss-animate`, nem de validação de formulário.**

### Integrações

Olist/Tiny ERP (read-only, fonte da verdade do catálogo) · Nuvemshop · Mercado Livre (OAuth2) ·
Shopee (Open Platform, HMAC) · Cloudflare R2 (S3-compatible) · Anthropic API (Ads Fase 4, opcional).

### Infraestrutura

Render (API) + Supabase Postgres (pooled 6543 / direct 5432) + Cloudflare R2 + frontend estático.
**Não há IaC, Dockerfile de produção nem CI versionados** — o deploy é manual, descrito em
`docs/deploy-render-supabase-r2.md`.

---

## 3. Princípios

1. **Fatias verticais.** Funcionalidade = contrato → banco → domínio → backend → cliente →
   interface → testes → observabilidade. Nunca "todas as telas primeiro, integração depois".
2. **Contratos explícitos.** Toda operação tem entrada, saída e erros definidos antes da UI.
3. **Validação nas fronteiras.** DTO com `class-validator` no backend; validação também no
   cliente, para UX — nunca *em vez do* backend.
4. **Autorização é sempre do backend.** Esconder botão não é autorização.
5. **Isolamento entre tenants.** Nenhuma query fora do `TenantContextStore`; todo schema novo
   com RLS + grant correspondentes.
6. **Migrations seguras.** Nenhuma operação destrutiva (drop/rename/narrow) sem plano de
   expand→migrate→contract, backfill e rollback declarados.
7. **Testes proporcionais ao risco.** Domínio e autorização primeiro; UI onde há regressão cara.
8. **Observabilidade.** Log estruturado e `AlertService` em toda falha de integração ou job.
9. **Acessibilidade.** Teclado, foco visível, contraste, `prefers-reduced-motion`.
10. **Desempenho.** Paginação obrigatória em listas; sem N+1; nada de bundle inflado por
    dependência decorativa.
11. **Decisões relevantes viram ADR** em `docs/decisions/`.
12. **Preservar a arquitetura existente.** Clean Architecture + portas + RLS não se
    reescrevem por preferência.

---

## 4. Comandos reais

Todos os comandos são executados **de dentro de cada app** — não há orquestração na raiz.

### Backend (`cd apps/api`)

| Objetivo | Comando |
|---|---|
| Instalar | `npm install` |
| Desenvolvimento | `npm run start:dev` (API em `http://localhost:3000/api`) |
| Produção local | `npm run build` && `npm run start:prod` |
| Build | `npm run build` (`nest build`) |
| Testes unitários | `npm test` (Jest, `src/**/*.spec.ts`) |
| Testes e2e | `npm run test:e2e` |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` — **não existe script `typecheck`** |
| Lint | `npm run lint` — **quebrado hoje: não há arquivo de configuração do ESLint** |
| Prisma client | `npm run prisma:generate` |
| Migration (dev) | `npm run prisma:migrate` |
| Migration (deploy) | `npx prisma migrate deploy` |
| Seed | `npm run prisma:seed` · demo: `npm run prisma:seed:demo` |
| Prisma Studio | `npm run prisma:studio` |

### Frontend (`cd apps/web`)

| Objetivo | Comando |
|---|---|
| Instalar | `npm install` |
| Desenvolvimento | `npm run dev` (`http://localhost:5173`, proxy `/api` → `:3000`) |
| Build | `npm run build` (`tsc -b && vite build`) |
| Typecheck | `npx tsc -b --noEmit` — **não existe script `typecheck`** |
| Preview | `npm run preview` |
| Lint | `npm run lint` — **quebrado hoje: não há arquivo de configuração do ESLint** |
| Testes | **não existem** — sem runner configurado |

### Infra local (raiz)

```bash
docker compose up -d      # Postgres 16 + Redis 7
```

### Validação geral

```bash
bash .claude/skills/product-engineering-studio/scripts/validate-project.sh
```

**Não existem hoje:** script `format`, `typecheck`, workers/filas (Redis sobe no compose mas
nenhum consumidor o usa), CI, testes de frontend. Não invente esses comandos — se forem
necessários, proponha em uma tarefa própria.

---

## 5. Como trabalhar aqui

Use a skill **`product-engineering-studio`** (`/product-engineering-studio <tarefa>`) para
qualquer funcionalidade que atravesse mais de uma camada. Ela define o fluxo A→G
(entendimento → contrato → planejamento → implementação vertical → revisão → validação → relatório).

Subagentes disponíveis em `.claude/agents/`: `product-architect`, `software-architect`,
`frontend-architect`, `backend-architect`, `database-architect`, `security-reviewer`,
`qa-reviewer`, `devops-reviewer`.

Documentação do sistema: `docs/architecture/claude-engineering-system.md`.

### Regras sempre carregadas

@.claude/rules/security.md
@.claude/rules/testing.md
@.claude/rules/documentation.md

> As regras de frontend, backend e banco são carregadas por escopo, via
> `apps/web/CLAUDE.md` e `apps/api/CLAUDE.md`.

---

## 6. Limites

Nunca, sem pedido explícito do usuário:

- implementar antes de inspecionar o código existente;
- inventar funcionalidade, propósito ou público do Kyneti que não esteja no repositório;
- entregar dado fictício/mock como solução final;
- confiar no frontend para autorização, ou ignorar `tenantId`;
- criar migration destrutiva silenciosa, ou tabela nova sem RLS + grant;
- instalar dependência (inclusive Motion, GSAP, Three.js, Lottie, Rive);
- introduzir framework concorrente ao que já existe (ex.: outra lib de estado, outro ORM);
- espalhar regra de negócio por controller ou componente visual;
- esconder falha de build/teste, ou afirmar que teste passou sem executá-lo;
- fazer commit, push, deploy, ou tocar em produção e serviços externos;
- expor segredo em código, log ou documentação;
- reescrever o projeto por preferência arquitetural.
