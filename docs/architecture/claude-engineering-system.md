# Sistema de engenharia do Claude Code — Kyneti

Documento de referência da camada de operação criada em `.claude/` e `CLAUDE.md`.
Criado em 02/08/2026.

---

## 1. Finalidade

Dar ao Claude Code, dentro deste repositório, uma forma **padronizada e verificável** de
planejar, implementar, revisar e validar funcionalidades de ponta a ponta — produto, domínio,
contrato, banco, backend, frontend, segurança, testes, observabilidade e infraestrutura.

Não é uma habilidade de "fazer telas". É um sistema de engenharia full stack, reutilizável em
SaaS, sistemas administrativos, dashboards, CRM, ERP, portais, páginas institucionais, landing
pages, APIs, integrações, rotinas assíncronas, módulos internos e produtos digitais completos.

O princípio que sustenta tudo: **nenhuma funcionalidade é só tela, só endpoint ou só tabela.**

```
usuário → interface → validação no cliente → contrato compartilhado → autenticação →
autorização → endpoint → serviço de aplicação → regra de domínio → persistência →
evento/integração → resposta → atualização da interface → feedback → auditoria →
monitoramento → testes
```

---

## 2. Componentes e a diferença entre eles

| Componente | Onde | Quando é carregado | Para que serve |
|---|---|---|---|
| **CLAUDE.md** | raiz, `apps/api/`, `apps/web/` | Sempre (raiz) e por escopo (apps) | Contexto **específico do projeto**: identidade, arquitetura comprovada, princípios, comandos reais |
| **Skill** | `.claude/skills/product-engineering-studio/` | Sob demanda (`/product-engineering-studio` ou por relevância da descrição) | **Processo genérico** de engenharia: fases, checklists, referências, templates |
| **Regras** | `.claude/rules/*.md` | Via `@import` do `CLAUDE.md` correspondente | Restrições por área, curtas e imperativas |
| **Subagentes** | `.claude/agents/*.md` | Quando delegados, em contexto próprio | Perspectiva especializada, com ferramentas mínimas e limites explícitos |
| **Hooks** | `.claude/settings.json` + `.claude/hooks/*.mjs` | Automaticamente, em eventos de ferramenta | Garantias mecânicas — o que não pode depender de o modelo lembrar |
| **Documentação** | `docs/` | Lida sob demanda | Registro durável: produto, arquitetura, decisões, contratos, banco, segurança, runbooks |

A separação existe para evitar duplicação. **Cada informação tem um dono:**

- Fato sobre **este** projeto (comando, módulo, stack) → `CLAUDE.md`.
- Como fazer engenharia em **qualquer** projeto → skill.
- Restrição curta e repetitiva de uma área → regra.
- Ponto de vista especializado sob demanda → subagente.
- O que precisa acontecer sem depender de memória → hook.
- Registro histórico e detalhado → `docs/`.

---

## 3. Estrutura criada

```
CLAUDE.md                          contexto permanente do Kyneti (mapa, não manual)
apps/api/CLAUDE.md                 contexto de escopo do backend
apps/web/CLAUDE.md                 contexto de escopo do frontend

.claude/
├── settings.json                  permissões + hooks (versionado, vale para o time)
├── settings.local.json.example    modelo de configuração pessoal + propostas de hook
├── hooks/
│   ├── guard-sensitive-write.mjs  bloqueia escrita em .env, migrations aplicadas, lockfiles
│   ├── guard-destructive-bash.mjs barra reset de banco, push, deploy, install, rm -rf
│   ├── scan-secrets.mjs           varre o arquivo recém-escrito em busca de segredo
│   └── migration-notice.mjs       lembra de RLS/grants e sinaliza SQL destrutivo
├── skills/product-engineering-studio/
│   ├── SKILL.md                   processo A→G + limites
│   ├── references/                13 checklists por área
│   ├── templates/                 7 documentos preenchíveis
│   └── scripts/validate-project.sh
├── agents/                        8 subagentes
└── rules/                         6 conjuntos de regras por área

docs/
├── architecture/                  este documento + arquitetura de módulos
├── product/                       feature specs
├── decisions/                     ADRs
├── api/                           contratos
├── database/                      schema, migrations, isolamento
├── security/                      revisões e achados
└── runbooks/                      procedimentos operacionais
```

---

## 4. Fluxo de trabalho

A skill define sete fases. Elas podem ser compactadas em tarefas pequenas, mas nunca puladas em
silêncio.

| Fase | O que acontece | Saída |
|---|---|---|
| **A — Entendimento** | Ler contexto, localizar código e documentação, identificar ator/objetivo/fluxo, registrar suposições | Diagnóstico |
| **B — Contrato** | Modelar domínio, definir dados, API, permissões, erros e eventos | `domain-model.md` + `api-contract.md` |
| **C — Planejamento** | Feature spec, plano, arquivos, riscos, testes, rollout | `feature-spec.md` + `implementation-plan.md` |
| **D — Implementação vertical** | contrato → banco → domínio → backend → cliente → frontend → testes → observabilidade | Código funcionando |
| **E — Revisão** | Arquitetura, segurança, QA, acessibilidade, desempenho, documentação | Achados por severidade |
| **F — Validação** | lint → typecheck → testes → build → migrations → fluxo ponta a ponta | Saída real dos comandos |
| **G — Relatório** | Alterações, decisões, comandos, resultados, riscos, pendências | Relatório honesto |

### Como iniciar uma funcionalidade

1. `/product-engineering-studio <descrição da funcionalidade>`
2. A skill executa a Fase A e apresenta o diagnóstico.
3. Aprove ou corrija o entendimento.
4. A skill produz contrato e plano (Fases B e C) — revise **antes** de qualquer código.
5. A implementação acontece em fatias verticais, cada uma funcionando ao final.
6. Revisão, validação e relatório fecham o ciclo.

### Exemplos de uso

```
/product-engineering-studio Planeje o módulo de cadastro de clientes do Kyneti.

/product-engineering-studio Implemente a criação de produtos de ponta a ponta, utilizando a
arquitetura existente.

/product-engineering-studio Revise o fluxo de autenticação, encontre inconsistências entre
frontend e backend e proponha correções.

/product-engineering-studio Crie um dashboard responsivo utilizando dados reais dos contratos
existentes.

/product-engineering-studio Planeje uma landing page animada para o Kyneti sem misturar o site
institucional com o aplicativo SaaS.
```

---

## 5. Quando usar cada subagente

| Subagente | Use quando | Não use para |
|---|---|---|
| `product-architect` | O pedido é vago, o escopo não está claro, faltam critérios de aceite | Escolher stack ou desenho técnico |
| `software-architect` | A mudança cruza módulos, cria contexto novo, altera acoplamento | Detalhe de UI ou índice de banco |
| `frontend-architect` | Criar/revisar telas, componentes, estado, formulários, animação | Definir contrato de API sozinho |
| `backend-architect` | Criar/revisar endpoints, casos de uso, regras, jobs, integrações | Alterar schema de banco |
| `database-architect` | **Sempre** que houver tabela, coluna, índice ou migration | Definir regra de negócio |
| `security-reviewer` | Antes de concluir algo que toque auth, permissões, dados sensíveis, uploads, integrações | Implementar a correção (ele revisa) |
| `qa-reviewer` | Antes de concluir, para avaliar cobertura vs. risco | Relaxar teste para passar |
| `devops-reviewer` | Mudança que afeta build, variáveis, deploy, migrations em produção | Executar deploy (nunca) |

Ordem típica em funcionalidade média: `product-architect` → `database-architect` +
`backend-architect` → `frontend-architect` → `security-reviewer` + `qa-reviewer`.

---

## 6. Hooks configurados

Todos são rápidos, sem dependência externa (só Node, já exigido pelo projeto), não alteram
arquivos e não acessam a rede.

| Hook | Evento | O que faz | Por que existe |
|---|---|---|---|
| `guard-sensitive-write.mjs` | `PreToolUse` em `Write`/`Edit`/`NotebookEdit` | Nega escrita em `.env`, artefatos de build e chaves; pergunta antes de alterar migration existente, lockfile ou `settings.local.json` | Impede a classe de erro mais cara: mexer em segredo ou em migration já aplicada |
| `guard-destructive-bash.mjs` | `PreToolUse` em `Bash` | Nega reset de banco, SQL destrutivo, force push, publish, deploy, `rm -rf` em raiz, `curl \| sh`, leitura de `.env`; pergunta antes de commit/push, `migrate deploy`, instalação de dependência, `psql` | O agente nunca deve tocar em produção nem instalar dependência por iniciativa própria |
| `scan-secrets.mjs` | `PostToolUse` em `Write`/`Edit` | Varre **apenas o arquivo recém-escrito** por chave privada, token de API, connection string com credencial e segredo atribuído em código. Bloqueia e explica — sem imprimir o valor | Segredo commitado é incidente com custo de rotação; barato de evitar na escrita |
| `migration-notice.mjs` | `PostToolUse` em `prisma/schema.prisma` e migrations | Lembra que **toda tabela nova exige `apply_*_rls_only.sql` + `grant_app_runtime_*.sql`**, e sinaliza SQL destrutivo. Não bloqueia | É o risco de drift nº 1 deste projeto (já houve gap real em `product_lots`) |

### Hooks deliberadamente **não** configurados

Registrados como proposta em `.claude/settings.local.json.example`, com o motivo:

- **Formatação automática** — o projeto não tem Prettier nem `.editorconfig`. Um hook de
  formatação aqui não teria o que executar.
- **Lint dos arquivos alterados** — não existe arquivo de configuração do ESLint em nenhum dos
  dois apps, embora o `eslint` esteja nas `devDependencies`. `npm run lint` falha hoje por falta
  de configuração, não por erro de código.
- **Typecheck a cada edição** — `tsc` do backend leva dezenas de segundos em 642 arquivos.
  Pesado demais para `PostToolUse`; sugerido como `Stop`, opt-in.
- **Testes relacionados** — viável no backend com `jest --findRelatedTests`, mas exige
  `node_modules` instalado e atrasa edições em sequência. Fica como opção pessoal.
- **Suíte completa de testes após cada edição** — proibido por princípio.

### Como revisar um hook

1. Leia o script — são arquivos curtos, em Node puro, sem dependência.
2. Teste sem efeito colateral:
   ```bash
   echo '{"tool_input":{"command":"git push origin main"}}' \
     | node .claude/hooks/guard-destructive-bash.mjs
   ```
3. Verifique o contrato: `PreToolUse` decide `allow`/`ask`/`deny`; `PostToolUse` com saída 2
   bloqueia e devolve o `stderr` ao agente; `additionalContext` apenas informa.
4. Regra permanente: hook **nunca** faz commit, push, deploy, acessa produção, guarda segredo,
   nem modifica arquivo de forma destrutiva.
5. Ao desativar um hook, remova-o de `.claude/settings.json` — não o esvazie deixando o script.

---

## 7. Adaptações ao formato oficial do Claude Code

Verificado contra a versão instalada: **Claude Code 2.1.220**.

| Pedido original | O que foi feito | Por quê |
|---|---|---|
| `.claude/rules/*.md` como mecanismo próprio | Os arquivos foram criados exatamente nesse caminho, mas são carregados por **`@import`** a partir do `CLAUDE.md` da raiz (segurança, testes, documentação) e dos `CLAUDE.md` por app (frontend em `apps/web/`, backend e banco em `apps/api/`) | O Claude Code não carrega `.claude/rules/` automaticamente. O mecanismo oficial de escopo é `CLAUDE.md` aninhado + `@import`. Assim as regras de fato entram no contexto — e só onde são relevantes |
| Hooks descritos apenas em `settings.json` | Lógica em `.claude/hooks/*.mjs`, referenciada por `command` | O formato oficial executa comandos de shell; scripts em Node dão parsing correto do JSON de entrada, mensagens claras e revisabilidade |
| `docs/` com sete subdiretórios | Criados com um `README.md` de índice cada, **sem mover** os 36 documentos já existentes na raiz de `docs/` | Mover documentos quebraria dezenas de referências cruzadas no `README.md` e entre os próprios documentos. A migração fica registrada como pendência |
| Skill "principal" única | `SKILL.md` enxuto + `references/` carregadas sob demanda | O corpo do `SKILL.md` entra no contexto quando a skill é acionada; detalhar tudo ali desperdiça contexto. Referências são lidas apenas quando a área é relevante |

---

## 8. Como atualizar a estrutura

- **Mudou comando, script ou stack** → `CLAUDE.md` correspondente (raiz ou app). Só isso.
- **Mudou o processo de engenharia** → `SKILL.md` ou a referência da área. Nunca copie o
  processo para o `CLAUDE.md`.
- **Nova restrição repetitiva de uma área** → `.claude/rules/<área>.md`. Se ela vale só para um
  app, garanta que o `CLAUDE.md` daquele app a importa.
- **Nova especialidade de revisão** → novo subagente, com ferramentas mínimas e limites escritos.
- **Nova garantia mecânica** → hook, depois de confirmar que é rápido, seguro e não destrutivo.
- **Decisão relevante** → ADR em `docs/decisions/`.

### Como evitar duplicação de instrução

Antes de escrever qualquer regra nova, pergunte: **de quem é esse fato?**

- É verdade só sobre o Kyneti? → `CLAUDE.md`.
- É verdade sobre engenharia em geral? → skill.
- É uma restrição curta que se repete numa área? → regra.
- É um registro histórico? → `docs/`.

Se a mesma frase aparecer em dois lugares, um deles está errado: apague e referencie o outro.
`CLAUDE.md` é mapa; instruções longas moram na skill e nas referências.

---

## 9. Limitações conhecidas

1. **Lint e formatação não são verificáveis hoje.** Sem configuração de ESLint e sem Prettier,
   o script de validação **pula** essas etapas — e diz que pulou. Item pulado não é item aprovado.
2. **Não há testes no frontend.** Nenhuma afirmação sobre comportamento de UI pode se apoiar em
   suíte automatizada neste app.
3. **Contratos duplicados manualmente** entre `apps/api` (DTOs) e `apps/web` (tipos em
   `features/*/api.ts`). O sistema mitiga por regra e checklist, não estruturalmente. A solução
   real (fonte única de schema) é uma tarefa própria, ainda não feita.
4. **Nenhum hook substitui revisão.** `scan-secrets.mjs` pega padrões conhecidos, não todos;
   `migration-notice.mjs` lembra, não impede.
5. **`docs/` continua plano.** Os 36 documentos existentes não foram movidos para os novos
   subdiretórios; a organização vale para documentos novos.
6. **Sem CI.** Nada do que está aqui roda automaticamente em push ou PR. A validação depende de
   alguém executá-la.
7. **A validação não pôde ser executada no ambiente em que este sistema foi criado** —
   `node_modules` não estava instalado em nenhum dos apps. Só verificações estáticas foram feitas.

---

## 10. Práticas de segurança da própria estrutura

- `.claude/settings.local.json` **nunca** é versionado (está no `.gitignore`). Configuração
  pessoal e atalhos de permissão ficam apenas na máquina de quem trabalha.
- Nenhum arquivo desta estrutura contém segredo, credencial, host interno ou token. O modelo
  `settings.local.json.example` também não — e não deve receber nenhum.
- A leitura de arquivos `.env` é negada por permissão **e** por hook. Para saber quais variáveis
  existem, use `apps/api/.env.example`.
- Commit, push, deploy, publicação e migration em ambiente real exigem confirmação — nenhum é
  feito por iniciativa do agente.
- Subagentes recebem **ferramentas mínimas**: `security-reviewer` e `devops-reviewer` não têm
  `Write` nem `Edit` — revisam, não alteram.
- Achado de segurança nunca reproduz o valor do segredo, e segredo encontrado é tratado como
  comprometido (rotação obrigatória).
