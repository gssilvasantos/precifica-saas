# docs/decisions — ADRs

Registros de decisão arquitetural (*Architecture Decision Records*).

## Quando abrir um ADR

Quando a decisão **restringe o futuro**: escolha de biblioteca ou framework, mudança de
fronteira entre módulos, estratégia de dados, modelo de autorização, mecanismo de integração,
ou abandono de uma alternativa que foi seriamente considerada.

Não abra ADR para: escolha de nome de variável, refatoração local, correção de bug.

## Convenções

- Arquivo: `NNNN-slug-curto.md`, numeração sequencial de quatro dígitos, **nunca reutilizada**.
- Template: `.claude/skills/product-engineering-studio/templates/adr.md`.
- ADR não se apaga. Se for superado, mude o `Status` para `substituído por ADR-NNNN` e crie o novo.
- Toda decisão tem data e o custo aceito escrito.

## Índice

| # | Título | Status | Data |
|---|---|---|---|
| [0001](./0001-sistema-de-engenharia-claude.md) | Sistema de engenharia do Claude Code | aceito | 2026-08-02 |
