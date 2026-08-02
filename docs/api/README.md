# docs/api

Contratos das operações expostas pela API (`apps/api`, prefixo `/api`).

## Convenções

- Um arquivo por módulo: `<modulo>.md`, com uma seção por operação.
- Template: `.claude/skills/product-engineering-studio/templates/api-contract.md`.
- O contrato é escrito **antes** da implementação da interface.
- Toda operação documenta: rota, método, autenticação, autorização (papel + módulo +
  propriedade do recurso + escopo de tenant), entrada, saída, erros, paginação, idempotência,
  eventos e exemplos.

## Dívida conhecida — tipos duplicados

Os tipos consumidos pelo frontend vivem à mão em `apps/web/src/features/*/api.ts` e **não** são
gerados a partir dos DTOs do backend. Não há verificação automática de divergência: uma mudança
de DTO que não for espelhada no cliente falha apenas em runtime, em produção.

Regra prática enquanto isso não for resolvido estruturalmente: **DTO alterado no backend e tipo
do cliente atualizado no mesmo commit.** Registre a operação afetada aqui.

## Índice

*(vazio — o primeiro contrato entra aqui)*
