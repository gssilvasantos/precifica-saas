# ADR 0002 — Configuração do ESLint e baseline de avisos

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-08-03 |
| **Decisores** | Dono do produto (gssilvasantos) |
| **Escopo** | Ferramental de qualidade — `apps/api` e `apps/web` |

## Contexto

O `eslint@8.57` estava nas `devDependencies` dos dois apps desde o início, com os plugins
`@typescript-eslint`, `eslint-plugin-react-hooks` e `eslint-plugin-react-refresh` no frontend.
**Não existia nenhum arquivo de configuração** (`.eslintrc*` nem `eslint.config.*`), então
`npm run lint` falhava por config ausente — não por erro de código. Na prática, o projeto passou
28 sprints sem nenhum lint executável.

Consequências disso:

- Nenhuma barreira automática contra código morto, `catch` vazio, comparação frouxa ou
  dependência faltando em hook do React.
- Nenhum hook de lint era possível no sistema de engenharia do Claude Code (ADR 0001) — ficou
  registrado ali como proposta bloqueada.
- O script `lint` do backend era `eslint ... --fix`: um "verificador" que **altera arquivos**.
  Um gate que muta o que verifica esconde violações e produz diff-surpresa.

## Decisão

**1. Formato e escopo.** `.eslintrc.cjs` em cada app (formato eslintrc, porque o projeto está no
ESLint 8, não no flat config). Base: `eslint:recommended` +
`plugin:@typescript-eslint/recommended` (+ `plugin:react-hooks/recommended` no frontend).

**2. Sem linting type-aware.** Não habilitamos `parserOptions.project` nem o conjunto
`recommended-requiring-type-checking`. Ele exige carregar o programa TypeScript inteiro a cada
execução; em 642 arquivos isso torna o lint lento demais para hook e para CI curto — e o
`typecheck` (`tsc --noEmit`) já cobre a parte de tipos.

**3. Regras que codificam invariantes já escritas do projeto**, em vez de só estilo:

- `no-empty` sem `allowEmptyCatch`: `catch` vazio engole falha de integração, que o projeto
  exige sinalizar via `AlertService`.
- `no-restricted-imports` barrando `axios` fora de `src/lib/`: acesso a dados passa pelo
  `apiClient` compartilhado (`.claude/rules/frontend.md`).
- `eqeqeq`, `no-console` (permitindo `warn`/`error`), `no-unused-vars` com escape `^_`.

**4. Exceções que são padrão deliberado, não dívida** — desligadas por `overrides`, com o motivo
no próprio arquivo:

- `no-constant-condition` com `checkLoops: false`: `while (true)` com `break` é o padrão de
  paginação dos clientes de Mercado Livre e Nuvemshop.
- `react-refresh/only-export-components` em `src/features/*/*-context.tsx` (Provider + hook de
  consumo colocalizados) e em `src/components/ui/*.tsx` (shadcn/ui exporta o componente e as
  variantes de `cva` juntos, como upstream).

**5. Baseline de avisos, congelado no script.** `npm run lint` roda com `--max-warnings=N`, onde
N é a contagem de avisos conhecidos no dia desta decisão: **5 no backend** (`no-explicit-any` em
repositórios Prisma de fronteira de integração) e **3 no frontend**
(`react-hooks/exhaustive-deps`). Aviso **novo** reprova o lint; o baseline existente fica
visível e contado. Ao corrigir um aviso, o número **desce** — nunca sobe.

**6. Scripts separados.** `lint` verifica (nunca altera); `lint:fix` é explícito e opcional.
Adicionados também `typecheck` nos dois apps, que não existiam.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Flat config (`eslint.config.js`) | Formato futuro do ESLint | Exigiria ESLint 9 — atualização de major com risco próprio, fora do escopo | Fica para uma tarefa de atualização de ferramental |
| Linting type-aware desde já | Pega bug real que só o tipo revela (promise não aguardada, comparação impossível) | Lento demais para hook por arquivo; inviabiliza a barreira automática | Reavaliar quando houver CI, onde a lentidão é tolerável |
| `--max-warnings=0` e corrigir tudo agora | Gate mais rígido | As 3 `exhaustive-deps` exigem mudança de comportamento (risco de loop de render) e os `any` de fronteira exigem tipar respostas de marketplace — duas tarefas próprias | Bloquearia o lint por tempo indeterminado, ou levaria a desativar a regra |
| Deixar avisos sem teto | Simples | Aviso que ninguém conta vira aviso que ninguém lê | O baseline é o que impede a dívida de crescer |
| Adotar Prettier junto | Formatação verificável | Reformataria ~770 arquivos, destruindo `git blame` do projeto inteiro | Decisão separada, com custo que o dono precisa aceitar conscientemente |

## Consequências

**Positivas**

- `npm run lint` passa a existir de verdade nos dois apps, com 0 erros.
- O hook `lint-changed-file.mjs` (ADR 0001) saiu de "proposta bloqueada" para ativo: cada arquivo
  editado é verificado na hora.
- Três invariantes de arquitetura do projeto passaram de documento para regra executável.

**Negativas / custo aceito**

- O baseline numérico em `package.json` é opaco sem este ADR — por isso está referenciado no
  `CLAUDE.md` da raiz e nos dois `CLAUDE.md` de app.
- Sem type-aware, uma classe de bug (promise não aguardada, por exemplo) continua invisível ao lint.
- 17 pontos de código morto foram removidos para chegar a zero erro (listados no commit); são
  mudanças mecânicas, mas tocam arquivos de produção e de teste.

## Riscos

| Risco | Sinal de alerta | Plano |
|---|---|---|
| Baseline usado como desculpa permanente | Número parado por meses | Revisar a cada sprint; a meta é chegar a `--max-warnings=0` |
| Alguém "resolver" um aviso desligando a regra | `eslint-disable` novo sem comentário | Todo `eslint-disable` precisa de justificativa na mesma linha |
| Baseline subir junto com o código | `--max-warnings` aumentado num commit | Aumentar o número é mudança que exige justificativa explícita |

## Reversibilidade

Alta. Remover os dois `.eslintrc.cjs` e reverter os scripts do `package.json` volta ao estado
anterior. As 17 remoções de código morto são independentes e permanecem válidas.

## Referências

- `apps/api/.eslintrc.cjs`, `apps/web/.eslintrc.cjs`
- `.claude/hooks/lint-changed-file.mjs`
- `docs/decisions/0001-sistema-de-engenharia-claude.md`
