# Segurança

> Esconder um botão no frontend **não é autorização**.

## Superfícies a revisar

| Superfície | Verificar |
|---|---|
| Autenticação | Força de senha, hash com algoritmo adequado, proteção contra força bruta, mensagem de erro que não revela existência de conta |
| Sessão/token | Expiração, renovação, revogação, onde é armazenado, o que acontece no logout |
| Autorização | Papel, permissão de módulo, propriedade do recurso — sempre no servidor, em toda operação |
| Isolamento de tenant | Toda leitura e escrita filtrada; bypass explícito e justificado |
| Injeção | Consulta parametrizada sempre; nada de concatenar entrada em SQL, comando ou caminho de arquivo |
| XSS | Nunca renderizar HTML de entrada do usuário sem sanitizar; cuidado com `dangerouslySetInnerHTML` e equivalentes |
| CSRF | Relevante para autenticação por cookie; com Bearer token em header, documente por que não se aplica |
| CORS | Origem restrita em produção; `*` é aceitável só em API pública sem credencial |
| Upload | Tipo e tamanho validados no servidor, nome sanitizado, armazenamento fora da raiz servida, sem execução |
| Segredos | Só em variável de ambiente/cofre; nunca em código, log, mensagem de erro ou documentação |
| Webhook | Assinatura verificada antes de qualquer processamento, replay barrado, idempotência |
| Rate limiting | Login, recuperação de senha, envio de e-mail, exportação, endpoints caros |
| Exposição de dados | Resposta traz só o necessário; sem campo interno, sem dado de outro tenant, sem enumeração de IDs |
| Logs | Sem senha, token, credencial, número de cartão ou PII desnecessária |
| Dependências | Sem pacote novo sem necessidade; verificar alerta conhecido antes de adicionar |
| Ações administrativas | Caminho separado, guard próprio, auditoria obrigatória |
| Ações destrutivas | Confirmação, auditoria, e possibilidade de reverter ou restaurar |

## Threat modeling rápido (15 minutos)

1. **Ativos**: o que um atacante quer? (dados de cliente, credenciais de marketplace, preços,
   capacidade de alterar valores)
2. **Atores**: anônimo, usuário de outro tenant, usuário com papel baixo do mesmo tenant,
   colaborador com acesso parcial, integração externa comprometida, administrador da plataforma
3. **Ameaças** por superfície nova introduzida pela funcionalidade
4. **Controles** existentes e faltantes
5. **Risco residual** aceito, escrito

## Severidade dos achados

| Nível | Critério | Exemplo |
|---|---|---|
| **Crítico** | Acesso a dado de outro tenant, execução remota, escalonamento de privilégio | Endpoint sem filtro de tenant |
| **Alto** | Exposição de dado sensível, bypass de autorização em recurso específico | Credencial em log |
| **Médio** | Falta de rate limiting, validação fraca, erro que vaza detalhe interno | Stack trace na resposta |
| **Baixo** | Endurecimento ausente, cabeçalho recomendado faltando | Falta de header de segurança |
| **Informativo** | Boa prática não seguida, sem exploração viável | Nome de cookie previsível |

Cada achado precisa de: onde (arquivo:linha), como explorar (cenário concreto), impacto,
correção proposta. Achado sem cenário de exploração é especulação — marque como tal.

## Regras de conduta

- Nunca commitar, imprimir ou "usar como exemplo" um segredo real.
- Nunca desabilitar verificação de TLS, validação, ou guard "temporariamente".
- Nunca alterar produção, serviço externo ou credencial durante uma revisão.
- Ao encontrar um segredo já commitado: reportar imediatamente, tratar como **comprometido**
  (rotação é obrigatória — remover do histórico não basta), não expor o valor no relatório.
