# ADR 0005 — Rate limiting de entrada com @nestjs/throttler

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-10-20 |
| **Decisores** | Claude (agente), a pedido do usuário, a partir de achado de auditoria de segurança |
| **Escopo** | plataforma (apps/api) |

## Contexto

Uma auditoria de segurança (skill `api-security-review`, OWASP API Security Top 10, 20/10/2026)
encontrou que nenhum endpoint de entrada da API tinha qualquer rate limiting. O único rate
limiting existente no projeto (`shared/rate-limiting/rate-limiter.ts` + `with-retry.ts`) protege
chamadas **de saída** aos marketplaces (Mercado Livre, Shopee, Olist, Nuvemshop) — nada protegia
`/api/auth/login`, `/api/auth/signup` ou qualquer outra rota contra brute-force, credential
stuffing ou criação de conta em massa. Isso contraria `.claude/rules/security.md`: "Rate limiting
em login, recuperação de senha, envio de e-mail, exportação e endpoints caros."

## Decisão

Usamos `@nestjs/throttler` (pacote oficial do ecossistema NestJS) para rate limiting de entrada,
registrado globalmente via `APP_GUARD` em `app.module.ts`, com um limite padrão de 60
requisições/60s por IP, e um limite mais restrito (5/60s) em `POST /api/auth/login` e
`POST /api/auth/signup` via `@Throttle` no próprio controller.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Rate limiting na camada de infraestrutura (proxy/CDN/API Gateway) | Não acopla a aplicação a mais uma dependência | Projeto não tem IaC, Dockerfile de produção, nem CI versionados (CLAUDE.md); deploy é manual no Render, sem proxy/WAF configurado hoje | Infra atual não oferece esse ponto de controle; esperar por isso deixaria o gap sem correção por tempo indeterminado |
| Implementar um guard próprio (contador em memória/Redis) | Zero dependência nova | Redis já sobe no `docker-compose` mas **nenhum consumidor o usa hoje** (CLAUDE.md); reinventar lock/expiração de contador é superfície de bug nova numa área de segurança | `@nestjs/throttler` já resolve isso, testado e mantido pelo próprio time do framework |
| `@nestjs/throttler` | Oficial, mínimo, já compatível com a versão do Nest usada (10.4) | Nova dependência (decisão que `security.md`/`CLAUDE.md` exige aprovação explícita para) | Pedido explícito do usuário na mesma sessão que pediu a correção de todos os achados da auditoria |

## Consequências

**Positivas**
- Login e signup passam a ter um teto de tentativas por IP (5/min), fechando o vetor de
  brute-force/credential-stuffing identificado na auditoria.
- Todo o restante da API ganha um teto geral (60/min por IP) sem precisar de `@Throttle`
  endpoint a endpoint.

**Negativas / custo aceito**
- Mais uma dependência de produção no `package.json` do backend.
- O limite por IP é ingênuo atrás de NAT/proxy compartilhado (vários usuários legítimos atrás do
  mesmo IP corporativo podem competir pelo mesmo teto) — aceitável para o estágio atual do
  produto; se isso incomodar, o próximo passo é uma chave de limite por `tenantId`/usuário
  autenticado em vez de só IP, não uma troca de biblioteca.

**O que fica mais difícil depois desta decisão**
- Nada estrutural: o guard é removível voltando ao estado anterior (remover o provider
  `APP_GUARD` e o `ThrottlerModule.forRoot`), mas isso reabriria o gap de segurança.

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| Limite global (60/60s) afeta algum fluxo legítimo de alto volume (ex.: um dashboard que faz muitas chamadas em paralelo) | Erros 429 inesperados reportados por usuários reais | Ajustar o limite global ou adicionar `@Throttle` com limite maior nesse endpoint específico — não remover o guard |
| Nenhum teste de carga real validou os números 60/60s e 5/60s | — | Valores escolhidos por julgamento (ordem de grandeza razoável para uma API interna de poucos usuários simultâneos), não medidos; ajustar com dados reais de produção quando houver |

## Reversibilidade

Alta: é uma dependência nova e um guard global, sem mudança de schema nem de contrato de API
(exceto a resposta 429 em caso de excesso, que é o comportamento esperado de qualquer rate
limiter). Remover é reverter os 2 arquivos tocados (`app.module.ts`, `auth.controller.ts`) e
desinstalar o pacote.

## Referências

- `.claude/rules/security.md` — regra de rate limiting.
- Achado original: auditoria com a skill `api-security-review` (OWASP API4 — Unrestricted
  Resource Consumption), 20/10/2026.
- https://docs.nestjs.com/security/rate-limiting
