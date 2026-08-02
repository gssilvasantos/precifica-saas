# Regras — Documentação

> Carregadas sempre (importadas pelo `CLAUDE.md` da raiz).

## Princípio

Documentação existe para quem chega depois — inclusive você, em três meses. Escreva o **porquê**;
o "o quê" está no código. Documentação que mente é pior que documentação ausente.

## O que atualizar, e quando

| Mudou | Atualize |
|---|---|
| Comando, script, variável de ambiente | `CLAUDE.md` (raiz ou do app) e `.env.example` |
| Arquitetura, fronteira, módulo novo | Documento de arquitetura do módulo em `docs/` |
| Decisão que restringe o futuro | **ADR** em `docs/decisions/` |
| Contrato de API | `docs/api/` e o tipo do cliente, no mesmo commit |
| Schema, migration, política de isolamento | `docs/database/` e o documento de multi-tenancy |
| Alerta novo, procedimento operacional | **Runbook** em `docs/runbooks/` |
| Funcionalidade de produto | Spec em `docs/product/` |
| Achado ou revisão de segurança | `docs/security/` |

## ADR

Abra um ADR quando a decisão **restringe o futuro**: escolha de biblioteca, mudança de fronteira,
estratégia de dados, modelo de autorização, mecanismo de integração, abandono de uma alternativa
considerada. Use `templates/adr.md`. Numeração sequencial, nunca reutilizada. ADR não se apaga —
se for superado, mude o status para "substituído por ADR-NNNN".

## Runbook

Todo alerta novo nasce com um runbook: o que significa, como confirmar, o que fazer, como
escalar, e como saber que acabou. Alerta sem runbook é ruído com atraso.

## Contratos

Documente antes de implementar. Cada operação: rota, método, autenticação, autorização, entrada,
saída, erros, paginação, idempotência, exemplos. Onde o tipo é duplicado entre backend e cliente,
registre a duplicação como dívida conhecida no próprio documento.

## Limitações e honestidade

- Registre o que **não** foi feito, o que não foi testado e o que não foi exercitado contra o
  serviço real. Isso vale mais que qualquer descrição do que funciona.
- Simplificação consciente é documentada como simplificação consciente, com o risco associado.
- Se a documentação existente estiver errada, corrija-a na mesma tarefa — ou registre a
  divergência explicitamente.
- Não escreva "implementado e testado" sem os dois.

## Estilo

- Objetivo. Sem adjetivo de marketing, sem "robusto", "poderoso", "de nível empresarial".
- Data em toda decisão e em todo achado.
- Referencie arquivo e linha quando afirmar algo sobre o código.
- Um assunto por documento. Não deixe um arquivo virar changelog + tutorial + arquitetura.
- Português consistente com o resto do repositório.

## Onde não documentar

- Não duplique instrução entre `CLAUDE.md`, skill, regras e `docs/`. Cada informação tem **um**
  dono; os outros lugares apenas referenciam.
- `CLAUDE.md` é mapa, não manual. Detalhe vai para a skill, as regras ou `docs/`.
- Comentário de código explica decisão não óbvia, não repete o que a linha já diz.
