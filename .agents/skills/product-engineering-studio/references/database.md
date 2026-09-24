# Banco de dados

## Antes de alterar o schema

Responda: quais contratos mudam? quais regras dependem disso? qual o impacto na interface?
como fica o rollback? há dado em produção? quanto essa tabela cresce por mês?

## Modelagem

- [ ] Entidades e relacionamentos (1:1, 1:N, N:N com tabela de junção explícita)
- [ ] Tipos corretos: dinheiro em decimal com precisão declarada (**nunca float**), data/hora
      com timezone, enum para conjunto fechado, texto com limite quando faz sentido
- [ ] Nulabilidade deliberada: `NULL` significa "desconhecido", não "vazio" nem "zero"
- [ ] Constraints: `NOT NULL`, `CHECK`, `UNIQUE` (composto com o identificador de tenant quando
      a unicidade é por conta), `FOREIGN KEY` com `ON DELETE` explícito
- [ ] Índices: toda FK usada em join, todo campo de filtro/ordenação frequente, índice composto
      na ordem de seletividade. Índice não usado é custo de escrita puro
- [ ] Histórico/auditoria: quem mudou o quê e quando, para campos de governança e ações
      irreversíveis — escopo explícito, não "audite tudo"
- [ ] Soft delete: só quando há motivo (referência histórica). Se existir, **toda** consulta
      precisa filtrar, e a unicidade precisa considerar o registro removido
- [ ] Multi-tenancy: identificador de tenant em toda tabela de negócio, participando dos índices
      e das políticas de isolamento

## Migrations

**Nenhuma migration destrutiva acontece em silêncio.** Destrutivo = `DROP` de tabela/coluna,
`RENAME`, mudança de tipo que perde dado, `NOT NULL` em coluna existente sem default,
remoção de valor de enum em uso, exclusão de índice único.

Padrão obrigatório para mudança incompatível — **expand → migrate → contract**:

1. **Expand**: adiciona a estrutura nova, opcional, sem quebrar o código atual. Deploy.
2. **Migrate**: backfill em lotes (idempotente, retomável, medindo tempo) + código passa a
   escrever nos dois lugares e ler do novo. Deploy.
3. **Contract**: remove a estrutura antiga quando não houver consumidor. Deploy.

Para cada migration, declare no plano:

- o que ela faz, em uma frase;
- se é destrutiva;
- se trava a tabela e por quanto tempo (índice em tabela grande → concorrente);
- o backfill e seu custo;
- o **rollback** — script reverso ou explicação de por que não é reversível;
- se exige artefato complementar do projeto (políticas de isolamento, grants de papel de
  runtime, view, trigger) — **tabela nova sem isso é vazamento ou quebra em produção**.

## Concorrência e crescimento

- Corrida real (estoque, saldo, numeração) → unicidade no banco ou trava explícita, não
  "verifica depois insere".
- Tabela de evento/log cresce sem parar: defina retenção, particionamento ou arquivamento
  **antes** de ela ficar grande.
- Consulta de listagem sem índice adequado é bug de produção esperando o volume chegar.
- Evite N+1: carregue relacionamento em uma consulta ou por lote.

## Dados sensíveis

Credencial de terceiro, token e segredo: criptografados em repouso, nunca em coluna plana,
nunca em log. Dado pessoal: minimize, defina retenção, e saiba responder "onde isso vive?".

## Validação

- Revise o diff do schema, não só o arquivo final.
- Rode a migration contra um banco descartável antes de qualquer ambiente compartilhado.
- Confirme que o cliente do ORM foi regenerado e que o typecheck passa.
- Confirme o isolamento de tenant na tabela nova com um teste, não com confiança.
