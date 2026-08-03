# Testes

## Princípio

Teste é proporcional ao **risco**, não à cobertura percentual. Risco = probabilidade de erro ×
custo do erro em produção. Cálculo de margem errado, autorização furada e vazamento entre
tenants são caros; um `<Badge>` que renderiza texto não é.

## Pirâmide

| Nível | O que cobre | Quando é obrigatório |
|---|---|---|
| **Unitário (domínio)** | Regra pura, cálculo, invariante, máquina de estados | Sempre que houver regra |
| **Unitário (serviço)** | Caso de uso com fakes das portas | Orquestração com mais de um passo |
| **Contrato** | Forma de entrada/saída e catálogo de erros | Endpoint consumido por outro app |
| **Integração** | Serviço + banco real (descartável) | Consulta complexa, transação, constraint, isolamento |
| **Componente** | Estados da UI (carregando/vazio/erro/sem permissão) | Componente com lógica de estado |
| **End-to-end** | Fluxo crítico completo, do login ao resultado | Caminho de receita e caminho irreversível |

## Casos que quase sempre faltam

- Entrada no limite: zero, negativo, vazio, máximo, string enorme, caractere especial, unicode.
- Decimal e arredondamento (dinheiro, percentual) — inclusive o caso "0,005".
- Data/hora: virada de dia, fuso, horário de verão, data futura, data absurda.
- **Sem permissão**: papel insuficiente, módulo não concedido, recurso de outro usuário.
- **Outro tenant**: usuário A tentando ler/alterar recurso do tenant B — deve falhar, sempre.
- Concorrência: duas requisições simultâneas sobre o mesmo recurso.
- Idempotência: mesma operação duas vezes, com o mesmo resultado.
- Falha do terceiro: timeout, 500, resposta malformada, rate limit, credencial expirada.
- Estado inconsistente pré-existente: registro órfão, campo nulo legado.
- Migration: aplicar em banco com dado, e o rollback.

## Regras de escrita

- Um teste falha por **um** motivo; o nome diz o comportamento esperado, não o método chamado.
- Sem dependência de ordem, relógio real ou rede. Congele o tempo; injete o aleatório.
- Fake de porta > mock de biblioteca > stub de HTTP. Nunca teste o mock em vez do código.
- Teste de regressão nasce do bug: reproduza primeiro, corrija depois.
- Dado de teste explícito no teste — factory sim, fixture mágica compartilhada não.

## Honestidade obrigatória

No relatório final, separe sempre:

- **Testes executados**: comando, quantidade, resultado real (cole a saída resumida).
- **Testes escritos mas não executados**: por quê (dependência ausente, sem banco, sem rede).
- **Testes apenas recomendados**: o que deveria existir e ainda não existe.

Nunca afirme que a suíte passou sem tê-la rodado. Nunca esconda falha. Se a suíte já estava
vermelha antes da sua mudança, diga isso e mostre a diferença.
