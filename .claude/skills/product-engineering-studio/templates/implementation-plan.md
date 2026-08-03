# Plano de implementação — <funcionalidade>

> Escrito **antes** de codar. Atualizado com os desvios ao final.

## Resumo

O que será construído, em 3–5 linhas.

## Diagnóstico atual

O que já existe e será reaproveitado. O que está faltando. O que está inconsistente e **não**
será corrigido agora (com motivo).

## Escopo

**Dentro:**
-

**Fora:**
-

## Arquivos

| Ação | Arquivo | Motivo |
|---|---|---|
| criar | | |
| alterar | | |
| remover | | |

## Contratos

Operações novas/alteradas, com compatibilidade (retrocompatível? exige versão nova?) e o ponto
de sincronização de tipos entre backend e cliente.

## Banco

| Migration | Destrutiva? | Backfill | Rollback | Artefatos complementares (isolamento/grants/índices) |
|---|---|---|---|---|
| | | | | |

## Backend

Módulo, camadas tocadas, serviços, portas novas, regras de domínio, autorização, transações,
idempotência, eventos.

## Frontend

Rotas, features, componentes, estado de servidor, formulários, estados de UI cobertos,
animações (com justificativa).

## Segurança

Superfícies novas, controles aplicados, o que será revisado por `security-reviewer`.

## Testes

O que será escrito, em que nível, e o que ficará apenas recomendado.

## Infraestrutura

Variáveis novas, storage, fila, cache, impacto em build/deploy.

## Rollout

Ordem de deploy, feature flag, migração progressiva, comunicação.

## Rollback

Como desfazer cada parte. Se alguma parte for irreversível, diga qual e por quê.

## Sequência de implementação (fatias verticais)

| # | Fatia | Entregável funcionando ao final |
|---|---|---|
| 1 | | |
| 2 | | |

## Pendências e riscos conhecidos

-
