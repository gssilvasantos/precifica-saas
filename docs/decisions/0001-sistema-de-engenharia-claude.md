# ADR 0001 — Sistema de engenharia do Claude Code em `.claude/`

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-08-02 |
| **Decisores** | Dono do produto (gssilvasantos) |
| **Escopo** | Plataforma (processo de engenharia, não código de produção) |

## Contexto

O repositório chegou a ~28 sprints com 19 módulos de backend, 34 páginas de frontend, 31
migrations, 36 documentos de arquitetura e um `README.md` de 1135 linhas que acumula changelog,
tutorial e arquitetura. Não havia `CLAUDE.md`, nenhuma configuração em `.claude/`, nenhum
subagente e nenhuma skill.

Consequências práticas disso:

- Cada sessão de trabalho reconstruía o contexto do zero, lendo um `README.md` de 216 KB.
- Convenções fortes e não óbvias (fronteira por `public-api.ts`, portas em `shared/contracts`,
  contexto de tenant obrigatório antes de qualquer query) só existiam no código e na cabeça de
  quem escreveu.
- A exigência mais frágil do projeto — **toda tabela nova precisa de políticas de RLS e grants
  aplicados à mão** — dependia inteiramente de memória. Um gap real já havia ocorrido em
  `product_lots`.
- Não havia barreira mecânica contra as ações mais caras: escrever em `.env`, editar migration
  já aplicada, resetar banco, instalar dependência, fazer commit/push/deploy por iniciativa
  própria.

## Decisão

Criamos uma camada de operação para o Claude Code composta por: `CLAUDE.md` na raiz e por app;
uma skill de engenharia full stack (`product-engineering-studio`) com referências, templates e
script de validação; oito subagentes especializados; seis conjuntos de regras por área; e quatro
hooks de garantia mecânica.

A separação de responsabilidades é explícita: **`CLAUDE.md` guarda o que é específico do Kyneti;
a skill guarda o processo genérico de engenharia; as regras guardam restrições curtas por área;
os subagentes guardam perspectivas especializadas; os hooks guardam o que não pode depender de
memória.** Cada informação tem um dono; os demais lugares apenas referenciam.

Nenhum código de produção, `package.json`, schema ou migration foi alterado. Nenhuma dependência
foi instalada.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Só um `CLAUDE.md` grande | Simples, um arquivo | Vira segundo `README.md` de 1000 linhas; contexto caro em toda sessão; sem escopo por área | Repete exatamente o problema que motivou a decisão |
| Skill focada em frontend/landing page | Entrega visual rápida | Ignora contrato, banco, autorização e isolamento de tenant — onde estão os riscos reais deste produto | O produto é um SaaS multi-tenant com dinheiro e fiscal envolvidos |
| Hooks agressivos (lint + typecheck + testes a cada edição) | Garantia forte | Não há configuração de ESLint nem Prettier no projeto (falharia por config ausente, não por erro); `tsc` leva dezenas de segundos em 642 arquivos | Hook que falha por motivo errado é ignorado, e hook lento é desativado |
| Reorganizar `docs/` movendo os 36 arquivos existentes | Estrutura limpa | Quebra dezenas de referências cruzadas no `README.md` e entre documentos | Custo alto, benefício estético; os subdiretórios valem para documentos novos |

## Consequências

**Positivas**

- Convenções não óbvias ficam legíveis e carregadas automaticamente, por escopo.
- A exigência de RLS/grants por tabela nova passa a ser lembrada mecanicamente, não por memória.
- Ações caras (segredo, migration aplicada, reset de banco, deploy, commit) exigem decisão
  consciente do usuário.
- Revisão de segurança, QA e DevOps ganham perspectivas com ferramentas mínimas —
  `security-reviewer` e `devops-reviewer` não têm permissão de escrita.
- O processo de trabalho fica documentado e reutilizável em outros produtos.

**Negativas / custo aceito**

- Mais uma estrutura para manter em dia. Documentação que mente é pior que ausente — o
  `CLAUDE.md` precisa acompanhar mudanças de stack e de comandos.
- Risco de duplicação de instrução entre `CLAUDE.md`, skill, regras e `docs/`. Mitigado pela
  regra "cada informação tem um dono", registrada em `.claude/rules/documentation.md`.
- Hooks adicionam latência pequena a cada `Write`/`Edit`/`Bash` (scripts em Node puro, sem rede).

**O que fica mais difícil**

- Contornar as barreiras exige ação explícita do usuário — deliberado, mas custa alguns cliques
  em fluxos legítimos (por exemplo, editar uma migration que ainda não saiu da máquina).

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| `CLAUDE.md` desatualiza e passa a mentir | Comando documentado que não existe mais | Revisar a cada mudança de stack; `.claude/rules/documentation.md` já obriga |
| Hooks viram ruído e são desativados em bloco | Usuário reclamando de interrupção | Ajustar regra específica, nunca remover a camada inteira |
| Falso positivo do `scan-secrets` em dado de teste | Bloqueio em arquivo legítimo | Agente deve declarar o falso positivo ao usuário; ajustar a allowlist do script |
| Estrutura usada como teatro (relatório bonito, validação não executada) | Relatório sem saída real de comando | A skill exige separar "executado" de "recomendado"; item pulado no script de validação é reportado como pulado |

## Reversibilidade

Alta. Remover `.claude/` e os arquivos `CLAUDE.md` devolve o repositório ao estado anterior sem
tocar em nenhuma linha de código de produção. Nenhuma dependência foi adicionada.

## Referências

- `docs/architecture/claude-engineering-system.md` — documentação completa da estrutura.
- `docs/row-level-security-architecture.md` — a exigência que motivou o hook `migration-notice`.
- `docs/platform-architecture.md` — arquitetura preservada por esta decisão.
