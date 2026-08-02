# apps/api — contexto de escopo (backend)

Complementa o `CLAUDE.md` da raiz. Carregado quando você trabalha em arquivos deste app.

## Forma do módulo

Todo bounded context em `src/modules/<nome>/` segue as mesmas 4 camadas:

```
domain/           entidades, value objects, tipos, regras puras — SEM Nest, SEM Prisma
application/      services (casos de uso) + ports/ (interfaces de repositório)
infrastructure/   implementação Prisma das portas, clientes HTTP externos, strategies
interface/        controllers, dto/, guards/, decorators/  (HTTP)
public-api.ts     ÚNICO ponto de import para outros módulos
<nome>.module.ts  wiring de DI
```

Dependência sempre para dentro: `interface`/`infrastructure` → `application` → `domain`.

## Regras não negociáveis deste app

- **Import cruzado entre módulos só via `public-api.ts`.** Nunca `import` de
  `../outro-modulo/application/...`, nunca ler a tabela Prisma de outro contexto.
- **Comunicação entre contextos por porta**: declare a interface em `shared/contracts/*.port.ts`,
  o token em `shared/contracts/tokens.ts`, e injete por token — nunca pela classe concreta.
- **Toda query Prisma roda dentro do `TenantContextStore`.** Jobs, scripts e handlers de evento
  precisam abrir o contexto com `TenantContextStore.run(tenantId, …)` ou `.runAsService(…)`.
  `runAsService` (bypass de RLS) exige justificativa em comentário.
- **Tabela/schema novo exige RLS.** Toda migration que cria tabela precisa do par
  correspondente em `prisma/manual-migrations/`: `apply_<x>_rls_only.sql` (policies) e
  `grant_app_runtime_<x>.sql` (GRANTs do papel `app_runtime`). Sem isso, o dado fica
  inacessível em produção ou — pior — acessível a outros tenants.
- **DTO valida na fronteira**: `class-validator` em `interface/dto/`. O `ValidationPipe` global
  já é `whitelist` + `forbidNonWhitelisted` — não relaxe isso por conveniência.
- **Controller é fino**: parse, guard, chamada de service, mapeamento de resposta. Regra de
  negócio vive em `application/` ou `domain/`.
- **Erro é `HttpException` do Nest com mensagem útil e sem vazamento** de dado de outro tenant,
  stack de terceiro, ou credencial.
- **Falha de integração externa emite `AlertService`** (`shared/observability`), nunca só
  `console.log` engolido.
- **Chamada a marketplace usa `shared/rate-limiting`** (`rate-limiter.ts` + `with-retry.ts`),
  nunca `fetch` cru em loop.
- **Credencial de terceiro passa por `CredentialEncryptionService`** — nunca em coluna plana.

## Testes

`*.spec.ts` ao lado do arquivo testado, Jest com `rootDir: src`. Priorize domínio puro,
services de aplicação com fakes de porta (`test/fakes/`), e autorização. E2E em `test/`.

## Comandos

```bash
npm run start:dev                    # watch
npm test                             # unit
npm run test:e2e                     # e2e
npx tsc -p tsconfig.json --noEmit    # typecheck (não há script)
npm run prisma:generate
```

## Regras carregadas neste escopo

@../../.claude/rules/backend.md
@../../.claude/rules/database.md
