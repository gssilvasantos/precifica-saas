# docs/security

Revisões de segurança, threat models e achados.

## Convenções

- Um arquivo por revisão: `AAAA-MM-DD-<escopo>.md`.
- Template: `.claude/skills/product-engineering-studio/templates/security-review.md`.
- Achados ordenados por severidade (Crítico → Alto → Médio → Baixo → Informativo), cada um com
  local (`arquivo:linha`), cenário concreto de exploração, impacto e correção proposta.
- Achado sem cenário de exploração é marcado como **especulativo**.
- **Nunca registre o valor de um segredo.** Cite o local e trate como comprometido — rotação é
  obrigatória; remover do histórico não basta.
- Risco residual aceito conscientemente é escrito, com prazo.

## Documentos existentes

- [`../auth-security.md`](../auth-security.md) — autenticação, OAuth dos canais, criptografia de
  credenciais de integração.
- [`../row-level-security-architecture.md`](../row-level-security-architecture.md) — isolamento
  entre tenants.

## Regras sempre em vigor

`.claude/rules/security.md` (carregado em toda sessão) e a referência `security.md` da skill.

## Índice

*(vazio — a primeira revisão entra aqui)*
