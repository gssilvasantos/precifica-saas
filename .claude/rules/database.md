# Regras — Banco de dados

> Carregadas via `apps/api/CLAUDE.md`. Aplicam-se ao schema, às migrations e a toda consulta.

## Migrations

- Uma migration faz **uma** coisa, com nome que descreve a intenção.
- Revise o **diff** do schema, não só o arquivo final.
- Aplique sempre em banco descartável antes de qualquer ambiente compartilhado.
- Regenere o cliente do ORM e rode o typecheck depois de mexer no schema.
- **Nunca** edite uma migration já aplicada em outro ambiente. Crie uma nova.

### Destrutivo — parar e avisar

`DROP` de tabela/coluna · `RENAME` · mudança de tipo com perda · `NOT NULL` em coluna existente
sem default · remoção de valor de enum em uso · remoção de índice único · `TRUNCATE`.

Nada disso acontece em silêncio. Apresente: o que se perde, quantos registros, o rollback, e
**peça confirmação explícita**.

### Mudança incompatível: expand → migrate → contract

1. Adiciona o novo, opcional, sem quebrar o código atual. Deploy.
2. Backfill idempotente e retomável; código escreve nos dois e lê do novo. Deploy.
3. Remove o antigo quando não houver mais consumidor. Deploy.

## Constraints e integridade

- `NOT NULL` sempre que "ausente" não for um estado válido.
- `CHECK` para faixa e invariante simples (percentual entre 0 e 100, valor não negativo).
- `UNIQUE` **composto com o identificador de tenant** quando a unicidade é por conta.
- `FOREIGN KEY` com `ON DELETE` explícito — nunca deixe o comportamento implícito.
- Dinheiro em decimal com precisão declarada. **Nunca float.**
- `NULL` significa "desconhecido"; não use como "zero" nem como "vazio".

## Índices

- Toda FK usada em join tem índice.
- Todo campo de filtro/ordenação frequente tem índice; composto na ordem de seletividade,
  começando pelo identificador de tenant quando ele participa de toda consulta.
- Índice não utilizado é custo de escrita puro — remova.
- Índice em tabela grande é criado de forma concorrente, com o tempo estimado no plano.

## Multi-tenancy

- Toda tabela de negócio tem o identificador de tenant.
- **Toda tabela nova exige os artefatos de isolamento e permissão do projeto**: políticas de
  linha e grants do papel de runtime, no diretório de migrations manuais. Sem esse par, ou o dado
  fica inacessível em produção, ou fica acessível para outra conta.
- Verifique o isolamento com um teste, não com confiança.

## Auditoria e histórico

- Escopo explícito: audite campos de governança e ações irreversíveis, não tudo por reflexo.
- Registro de auditoria é append-only e guarda ator, momento, valor anterior e novo.
- Tabela de evento/log tem política de retenção definida **antes** de crescer.

## Soft delete

Só com motivo (referência histórica). Se existir: toda consulta filtra, a unicidade considera o
registro removido, e a UI deixa claro o que "excluir" significa.

## Segurança

- Credencial e token de terceiro sempre criptografados em repouso, nunca em coluna plana.
- Consulta sempre parametrizada. Nunca concatene entrada do usuário em SQL.
- Dado pessoal: minimize, defina retenção, saiba responder "onde isso vive?".

## Desempenho

- Sem N+1: carregue relacionamento em uma consulta ou por lote.
- Listagem sempre paginada, com teto no servidor.
- Consulta nova em tabela grande: verifique o plano de execução antes de mandar para produção.

## Rollback e backfill

- Todo plano de migration declara o rollback — ou declara explicitamente por que é irreversível.
- Backfill é idempotente, roda em lotes, é retomável e tem custo estimado.
- Nunca rode backfill longo dentro da janela de deploy sem medir antes.
