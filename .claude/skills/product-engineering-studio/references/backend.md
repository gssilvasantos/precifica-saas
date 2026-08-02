# Backend

## Ordem de execução de um endpoint

```
1. autenticação        quem é?
2. autorização         pode fazer isso, neste recurso, neste tenant?
3. validação           a entrada é bem formada e dentro dos limites?
4. serviço de aplicação orquestra o caso de uso
5. regra de domínio    invariantes verificadas onde vivem
6. persistência        transação com escopo mínimo
7. evento/integração   efeitos, com falha isolada e reprocessável
8. resposta            DTO de saída explícito, sem vazar campo interno
9. observabilidade     log estruturado + alerta em falha
```

Nenhum passo pode ser pulado "porque é um endpoint simples".

## Validação

- Valide na fronteira, com schema declarativo. Rejeite campos desconhecidos.
- Limite tamanho: string, array, upload, profundidade de objeto, tamanho do corpo.
- Normalize antes de validar (trim, lowercase de e-mail) e depois use só o valor normalizado.
- Nunca confie em valor calculado enviado pelo cliente (total, margem, peso). Recalcule no servidor.

## Autorização

- Verificada **no servidor**, em toda operação, inclusive nas de leitura.
- Três perguntas separadas: papel permite a ação? o recurso pertence a este tenant? este
  usuário tem acesso a este recurso específico?
- Autorização baseada em recurso não pode ser feita só por papel: carregue o recurso, cheque o
  vínculo, e trate "não encontrado" e "sem permissão" de forma coerente.
- Ação administrativa/cross-tenant é caminho separado, com guard próprio e auditoria.

## Isolamento de tenant

- Toda leitura e escrita é filtrada por tenant — no melhor caso, por mecanismo estrutural
  (RLS, contexto obrigatório), não por lembrança do desenvolvedor.
- Qualquer bypass de isolamento (job de plataforma, migração de dados) é explícito, nomeado e
  justificado em comentário.
- Job, cron, handler de evento e script também precisam abrir o contexto de tenant.

## Serviços e domínio

- Controller/handler é fino: entrada, guard, chamada, saída.
- Regra de negócio mora no domínio (funções/entidades puras) ou no serviço de aplicação.
- Serviço depende de **porta** (interface), não de implementação concreta — facilita teste com
  fake e troca de infraestrutura.
- Evite serviço que só repassa chamada; evite entidade anêmica quando existe invariante real.

## Transações

- Escopo mínimo: só o que precisa ser atômico. Nunca chamada HTTP externa dentro de transação.
- Operação que altera duas agregações relacionadas: uma transação, ou um evento com compensação
  explícita — escolha e documente.
- Concorrência: use unicidade no banco, `SELECT ... FOR UPDATE`/versão otimista onde há corrida
  real (estoque, saldo, numeração sequencial).

## Idempotência

Necessária em webhook, retry, importação, e qualquer operação repetível pelo usuário.
Implemente com chave de idempotência persistida ou unicidade natural da referência externa.
Repetir a operação deve retornar o mesmo resultado, sem duplicar efeito.

## Erros

- Catálogo de erros com código estável; mensagem sem stack, SQL, credencial ou dado alheio.
- Erro de terceiro nunca vaza cru para o cliente — traduza.
- Falha esperada (regra de negócio) ≠ falha inesperada (bug/indisponibilidade): status,
  severidade de log e alerta diferentes.

## Limites e proteção contra abuso

- Paginação com teto no servidor.
- Rate limiting em endpoint de autenticação, envio de e-mail, exportação e qualquer operação cara.
- Timeout em toda chamada de saída; nenhuma espera infinita.
- Trabalho pesado sai do ciclo de requisição (job/fila), com estado consultável.

## Observabilidade

- Log estruturado (evento, tenant, recurso, duração, resultado) — nunca com segredo ou PII
  desnecessária.
- Falha de integração ou de job emite alerta pelo mecanismo do projeto, não `console.log` mudo.
- Ver `observability.md`.

## Testes

Prioridade: domínio puro → serviço com fakes de porta → autorização e isolamento de tenant →
contrato HTTP. Ver `testing.md`.
