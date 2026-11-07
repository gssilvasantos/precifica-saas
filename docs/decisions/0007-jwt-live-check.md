# ADR 0007 — Checagem em tempo real de usuário/tenant no JwtStrategy

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-10-20 |
| **Decisores** | Claude (agente), a pedido do usuário, a partir de achado de auditoria de segurança |
| **Escopo** | módulo (identity-access) |

## Contexto

A auditoria de segurança (skill `jwt-security-review`, 20/10/2026) encontrou que
`JwtStrategy.validate()` apenas remapeava o payload do token (`sub`, `tenantId`, `role`,
`moduleAccess`) para `request.user`, sem nenhuma consulta ao banco. O próprio código já
documentava essa limitação (`auth.types.ts`, comentário em `JwtPayload.moduleAccess`:
"Baked no token... revogar exige novo login") — era uma simplificação conhecida, não um
descuido, mas o achado da auditoria tornou o custo concreto: com `JWT_EXPIRES_IN="8h"`
(`.env.example`), as seguintes ações administrativas não tinham efeito nenhum enquanto o
token do usuário afetado não expirasse:

- Desativar um usuário (`setActive(..., false)`, `UsersService`).
- Trocar o papel ou os módulos concedidos (`updateModuleAccessAndRole`).
- Desativar o tenant inteiro (nenhum mecanismo de "forçar logout" existia).

Ou seja: banir alguém levava até 8 horas para realmente bloqueá-lo.

## Decisão

`JwtStrategy.validate()` passa a ser assíncrono e consulta o estado ATUAL do usuário e do
tenant a cada requisição autenticada, via `UsersService.findByIdWithTenantStatus()` (novo
método, `UserRepository.findByIdWithTenantStatus`, implementado em
`PrismaUserRepository` com `include: { tenant: { select: { isActive: true } } }`). `role` e
`moduleAccess` devolvidos ao `request.user` vêm do banco, não do token — o token continua
carregando esses campos (ainda lidos em `auth.service.ts` na emissão), mas eles deixam de
ser a fonte de verdade em tempo de requisição.

**Detalhe de implementação que molda o desenho:** guards do NestJS executam ANTES dos
interceptors. `TenantContextInterceptor` (que normalmente abre o `TenantContextStore` lido
pela extensão de RLS do Prisma) ainda não rodou quando `JwtStrategy.validate()` executa —
então a consulta precisa abrir o próprio contexto de tenant, com
`TenantContextStore.run(payload.tenantId, fn)`, do mesmo jeito que jobs/schedulers já fazem.
Rejeita com `UnauthorizedException` (401) quando: usuário não existe mais, usuário inativo,
tenant inativo, ou (defesa extra) o `tenantId` do usuário encontrado não bate com o do
payload.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Blacklist de tokens revogados (Redis) | Revogação imediata sem consulta extra no caminho normal | Precisa de infraestrutura nova (Redis já existe no `docker-compose` mas nenhum consumidor o usa hoje — seria o primeiro); mais um lugar para esquecer de limpar | Mais correto para "logout único"/rotação de refresh token, mas não resolve sozinho o caso de ban/mudança de papel sem reimplementar a mesma consulta ao usuário |
| Reduzir drasticamente `JWT_EXPIRES_IN` (ex.: 5 min) + refresh token | Sem custo de query extra por request | Exige implementar fluxo de refresh token do zero (não existe hoje); e-mail/senha teria que ser pedido de novo com mais frequência sem refresh | Mudança maior, fora do escopo do achado — e ainda não fecha o gap, só encurta a janela |
| Deixar como estava, documentado como simplificação aceita | Zero esforço | Achado de severidade alta da auditoria, sem mitigação | Inaceitável dado o achado e a instrução explícita de corrigir |

## Consequências

**Positivas**
- Ban, mudança de papel/módulo e desativação de tenant têm efeito imediato (próxima
  requisição), não mais "até o token expirar".
- Fecha também parte do achado relacionado de "payload confiado sem verificação" — `role`
  e `moduleAccess` no `request.user` agora refletem o banco, não um claim antigo do token.

**Negativas / custo aceito**
- Uma consulta Prisma adicional (`findUnique` por `id`, indexado — chave primária) em toda
  requisição autenticada. Overhead esperado: uma leitura simples por PK, mesma ordem de
  grandeza das outras consultas que já rodam por requisição (ex.: `TenantContextInterceptor`
  hoje não consulta nada, então este é o primeiro "custo de banco" adicionado ao pipeline de
  auth em si). Não medido sob carga real nesta sessão — vale observar `AlertService`/latência
  de endpoint após o próximo deploy.
- Não é uma blacklist/revogação instantânea de um token específico roubado — um token ainda
  válido (usuário ativo, tenant ativo, mesmo papel) continua sendo aceito até expirar. O que
  fica resolvido é a revogação **administrativa** (ban, mudança de papel/módulo, desativação
  de tenant), não o roubo de token em si.

**O que fica mais difícil depois desta decisão**
- `JwtStrategy` agora depende de `UsersService` (e, por tabela, de `TenantContextStore`) —
  um teste que instancia `JwtStrategy` direto precisa injetar um mock de `UsersService`
  (feito em `jwt.strategy.spec.ts`).

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| Latência adicional perceptível em endpoints de alto tráfego | p95/p99 de latência sobe após o deploy, correlacionado com volume de requisições autenticadas | Medir antes de otimizar; se confirmado, considerar cache de curta duração (segundos) do resultado por `userId`, aceitando uma janela pequena de atraso na revogação em troca de menos carga no banco |
| `findByIdWithTenantStatus` rodando sem contexto de tenant aberto corretamente (erro de wiring futuro) | Exceção da extensão de RLS do Prisma ("query sem contexto") nos logs, vinda do meio do fluxo de autenticação | Confirmar que o `TenantContextStore.run()` em `JwtStrategy.validate()` não foi removido/alterado por engano |

## Reversibilidade

Média: reverter para o `validate()` síncrono anterior é simples (remover a consulta, voltar
a remapear o payload), mas reintroduz o gap de revogação que motivou esta decisão — qualquer
reversão deveria vir com uma mitigação equivalente.

## Referências

- Achado original: auditoria com a skill `jwt-security-review`, 20/10/2026.
- `apps/api/src/shared/prisma/tenant-context.interceptor.ts` — confirma guards-antes-de-interceptors.
- `.claude/rules/security.md` — "Autorização é sempre verificada no servidor, em toda operação".
