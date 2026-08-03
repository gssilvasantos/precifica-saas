# Regras — Segurança

> Carregadas sempre (importadas pelo `CLAUDE.md` da raiz). Valem para todo o repositório.

## Segredos

- **Nunca** escreva segredo real em código, teste, log, mensagem de erro, documentação, commit
  ou resposta de chat. Nem "só para o exemplo".
- Segredo vive em variável de ambiente/cofre. Toda variável nova entra no arquivo `.env.example`
  com explicação: para que serve, como obter, o que acontece se faltar.
- **Falhe alto na inicialização** quando faltar variável obrigatória. Fallback silencioso para
  chave de desenvolvimento em produção é incidente, não conveniência.
- Ao encontrar segredo commitado: avise imediatamente, **não reproduza o valor**, e trate como
  comprometido — rotação é obrigatória; remover do histórico não basta.
- Nunca leia arquivos `.env` para "conferir" valores. Leia o `.env.example`.

## Permissões

- Autorização é sempre verificada no servidor, em toda operação, inclusive nas leituras.
- Esconder botão, desabilitar campo ou omitir rota **não é autorização**.
- Papel ≠ propriedade do recurso ≠ escopo de tenant. Verifique os três.
- Ação administrativa e cross-tenant: caminho separado, guard próprio, auditoria obrigatória.
- Nunca aceite identificador de tenant vindo do cliente.

## Dados sensíveis

- Resposta traz só o necessário. Nada de "devolve a entidade inteira e o front filtra".
- Credencial de terceiro criptografada em repouso.
- Dado pessoal: minimizar, definir retenção, e nunca copiar para outro ambiente sem anonimizar.
- Mensagem de erro não revela existência de recurso quando isso já é vazamento.

## Entrada e uploads

- Toda entrada externa é validada e normalizada na fronteira — inclusive payload de webhook e
  resposta de API de terceiro.
- Consulta sempre parametrizada; nada de concatenar entrada em SQL, comando de shell ou caminho.
- Upload: tipo e tamanho validados **no servidor**, nome sanitizado, armazenado fora da raiz
  servida, sem possibilidade de execução.
- Conteúdo do usuário nunca é renderizado como HTML sem sanitização.

## Logs

- Sem senha, token, credencial, chave, número de documento/cartão ou PII desnecessária.
- Log estruturado com contexto suficiente para investigar sem expor dado sensível.
- Nunca logue o corpo inteiro de uma requisição sensível "para depurar".

## Endpoints

- Rota nova é autenticada por padrão; exceção é deliberada, documentada e protegida de outra forma.
- Rate limiting em login, recuperação de senha, envio de e-mail, exportação e endpoints caros.
- Paginação com teto no servidor.
- CORS restrito por origem em produção.

## Webhooks

- Assinatura verificada **antes** de qualquer processamento.
- Replay barrado (janela de timestamp e/ou ID já processado).
- Idempotência pelo identificador do evento externo.
- Resposta rápida; processamento pesado fora do handler.

## Dependências

- Nenhuma dependência nova sem necessidade concreta e aprovação explícita do usuário.
- Verifique procedência, manutenção e alerta conhecido antes de propor.
- Nunca adicione dependência só para um único helper que cabe em dez linhas.

## Ações destrutivas

- Excluir, sobrescrever, truncar, revogar e migrar destrutivamente: confirmação explícita,
  auditoria, e caminho de restauração — ou declaração clara de que não há.
- Nunca execute ação destrutiva "para testar".

## Conduta proibida

Alterar produção · tocar em serviço externo, DNS ou domínio · rodar migration em banco
compartilhado · desabilitar verificação de TLS, validação ou guard "temporariamente" ·
fazer commit, push ou deploy sem pedido explícito.
