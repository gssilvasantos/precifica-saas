# Regras — Testes

> Carregadas sempre (importadas pelo `CLAUDE.md` da raiz).

## Proporcionalidade

Teste é proporcional ao **risco** = probabilidade de erro × custo do erro em produção.
Não persiga percentual de cobertura. Persiga os caminhos caros:

1. Cálculo financeiro, fiscal, de margem, de estoque.
2. Autorização e isolamento entre tenants.
3. Máquina de estados e transições irreversíveis.
4. Integração com sistema externo (com fake, no mínimo).
5. Migration com dado existente.

## Pirâmide

| Nível | Cobre | Obrigatório quando |
|---|---|---|
| Unitário (domínio) | Regra pura, invariante, cálculo | Sempre que houver regra |
| Unitário (serviço) | Caso de uso com fakes de porta | Orquestração com mais de um passo |
| Contrato | Forma de entrada/saída e catálogo de erros | Endpoint consumido por outro app |
| Integração | Serviço + banco descartável | Consulta complexa, transação, constraint, isolamento |
| Componente | Estados de UI | Componente com lógica de estado |
| End-to-end | Fluxo crítico completo | Caminho de receita e caminho irreversível |

## Casos obrigatórios

- **Isolamento**: usuário do tenant A tentando ler **e escrever** recurso do tenant B — deve
  falhar sempre, em todo endpoint novo.
- **Ausência de permissão**: papel insuficiente, módulo não concedido, recurso de outro usuário.
- **Erros**: entrada inválida (todos os campos), recurso inexistente, conflito, terceiro fora
  do ar, timeout, rate limit, resposta malformada.
- **Limites**: zero, negativo, vazio, máximo, unicode, string enorme.
- **Decimal**: arredondamento de dinheiro e percentual, inclusive o caso do meio.
- **Idempotência**: mesma operação duas vezes, mesmo resultado, sem efeito duplicado.
- **Concorrência**: duas requisições simultâneas no mesmo recurso.
- **Migrations**: aplicação em banco com dado, e o rollback.

## Isolamento do teste

- Sem dependência de ordem de execução, relógio real, rede ou estado compartilhado.
- Congele o tempo; injete o aleatório.
- Fake de porta > mock de biblioteca > stub de HTTP. Nunca teste o mock.
- Dado explícito no próprio teste; factory sim, fixture mágica global não.
- Um teste falha por um motivo; o nome descreve o comportamento, não o método.

## Honestidade

No relatório, **sempre separe**:

- **Executado**: comando, quantidade e resultado real (cole a saída relevante).
- **Escrito, não executado**: e o motivo (dependência ausente, sem banco, sem rede).
- **Apenas recomendado**: o que deveria existir e ainda não existe.

Proibido: afirmar que a suíte passou sem tê-la rodado · esconder falha · relaxar assert para
passar · apagar teste incômodo · atribuir à sua mudança uma falha que já existia (mostre a
diferença).

## Regressão

Todo bug corrigido nasce com um teste que reproduz o caso original. Primeiro o teste vermelho,
depois a correção.
