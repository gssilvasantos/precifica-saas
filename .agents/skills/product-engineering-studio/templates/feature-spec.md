# Feature Spec — <nome da funcionalidade>

> Salvar em `docs/product/<slug>.md`. Campo sem resposta = **a definir** (nunca inventar).

| | |
|---|---|
| **Status** | rascunho / em revisão / aprovada / implementada |
| **Data** | AAAA-MM-DD |
| **Módulo(s)** | |
| **Documentos relacionados** | |

## Contexto

O que existe hoje. Como o usuário resolve isso atualmente.

## Problema

A dor concreta, com custo. Não "seria bom ter".

## Objetivo

O resultado esperado, em uma frase verificável.

## Atores

| Ator | Papel/permissão | O que faz nesta funcionalidade |
|---|---|---|
| | | |

## Fluxo principal

1.
2.
3.

## Fluxos alternativos

| # | Situação | Comportamento esperado |
|---|---|---|
| A1 | Dado ausente | |
| A2 | Sem permissão | |
| A3 | Falha de integração | |
| A4 | Conflito/concorrência | |
| A5 | Cancelamento/retomada | |

## Regras de negócio

| # | Regra | Onde é garantida (domínio / banco / fronteira) |
|---|---|---|
| R1 | | |

## Permissões

| Ação | Quem pode | Verificação no servidor |
|---|---|---|
| Ver | | |
| Criar | | |
| Editar | | |
| Excluir | | |
| Aprovar/administrar | | |

## Dados

Entidades envolvidas, campos novos, sensibilidade, volume estimado, retenção.

## Contratos

Operações necessárias (detalhar em `api-contract.md`):

| Operação | Método + rota | Autorização |
|---|---|---|
| | | |

## Estados da interface

| Estado | Comportamento |
|---|---|
| Inicial | |
| Carregando | |
| Sucesso | |
| Vazio (primeira vez / filtro) | |
| Erro | |
| Validação | |
| Sem permissão | |
| Confirmação | |
| Atualizando | |
| Conflito | |
| Assíncrono em andamento | |

## Eventos

Eventos de domínio emitidos e seus consumidores.

## Integrações

Sistemas externos envolvidos, papel de cada um, o que acontece se estiverem fora.

## Segurança

Superfície nova, ameaças, controles, isolamento de tenant, auditoria.

## Critérios de aceite

- [ ] Dado ..., quando ..., então ...
- [ ]
- [ ]

## Testes

| Nível | O que cobrir |
|---|---|
| Domínio | |
| Serviço | |
| Autorização / tenant | |
| Integração | |
| Componente / e2e | |

## Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|

## Fora do escopo

O que **não** será feito agora, e por quê.

## Suposições

Tudo que foi assumido sem confirmação — para ser desmentido cedo.
