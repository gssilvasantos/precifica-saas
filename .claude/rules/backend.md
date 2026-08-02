# Regras — Backend

> Carregadas via `apps/api/CLAUDE.md`. Aplicam-se a todo código em `apps/api/`.

## Validação

- Todo DTO de entrada é validado na fronteira, com rejeição de campo desconhecido.
- Nunca confie em valor calculado enviado pelo cliente (total, margem, peso, preço final):
  **recalcule no servidor**.
- Normalize antes de validar (trim, lowercase de e-mail) e use só o valor normalizado.
- Limite tamanho de string, array, upload e corpo da requisição.
- Não relaxe a configuração global de validação por conveniência de um endpoint.

## Autenticação e autorização

- Toda rota é autenticada, salvo exceção deliberada e documentada (login, cadastro, webhook,
  saúde) — e cada exceção tem sua própria proteção.
- Autorização é verificada **no servidor**, em toda operação, **inclusive nas leituras**.
- Três perguntas separadas, sempre: o papel permite a ação? o recurso é deste tenant? este
  usuário tem acesso a este recurso específico?
- Autorização por recurso não se resolve só com papel: carregue o recurso e cheque o vínculo.
- Ação administrativa/cross-tenant usa caminho e guard próprios, e sempre gera auditoria.

## Isolamento de tenant

- **Nenhuma query roda fora do contexto de tenant.** Jobs, cron, handlers de evento e scripts
  precisam abrir o contexto explicitamente.
- Bypass de isolamento (rotina de plataforma, migração de dados) é nomeado, isolado e
  justificado em comentário no código.
- Nunca receba o identificador de tenant do corpo da requisição ou de query string. Ele vem do
  token/sessão.

## Serviços e domínio

- Controller é fino: entrada, guard, chamada, saída. Regra de negócio nunca no controller.
- Regra vive no domínio (funções/entidades puras) ou no serviço de aplicação.
- Serviço depende de **porta** (interface + token), nunca de implementação concreta.
- Módulo só importa de outro módulo pela fronteira pública declarada. Nunca acesse o
  armazenamento de outro contexto.
- Evite serviço que só repassa chamada; evite entidade anêmica quando há invariante real.

## Transações

- Escopo mínimo. **Nunca** chamada HTTP externa dentro de transação.
- Duas agregações alteradas juntas: uma transação, ou evento com compensação explícita —
  escolha e documente.
- Corrida real (estoque, saldo, numeração) usa unicidade no banco ou trava explícita.

## Idempotência

Obrigatória em webhook, retry automático, importação e qualquer operação repetível pelo usuário.
Repetir não pode duplicar efeito. Use chave de idempotência persistida ou unicidade natural da
referência externa.

## Erros

- Catálogo com código estável; a UI decide comportamento pelo código, não pela mensagem.
- Mensagem sem stack, SQL, credencial, caminho de arquivo ou dado de outro tenant.
- Erro de terceiro é traduzido, nunca repassado cru.
- Falha de regra de negócio ≠ falha inesperada: status, log e alerta diferentes.
- Erro de validação retorna **todos** os campos inválidos.

## Observabilidade

- Log estruturado com evento, tenant, recurso, duração e resultado. Sem segredo, sem PII
  desnecessária.
- Falha de integração ou de job **emite alerta** pelo mecanismo do projeto — nunca um
  `console.log` engolido nem um `catch` vazio.
- Job novo registra início, fim e resultado.

## Limites e proteção

- Paginação com teto aplicado no servidor.
- Timeout em toda chamada de saída; retry com backoff só para erro transitório.
- Rate limiting em login, recuperação de senha, envio de e-mail e operações caras.
- Trabalho pesado sai do ciclo de requisição, com estado consultável.

## Testes

Domínio puro → serviço com fakes de porta → autorização e isolamento de tenant → contrato HTTP.
Todo bug corrigido ganha um teste que reproduz o caso.
