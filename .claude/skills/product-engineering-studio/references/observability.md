# Observabilidade

Uma funcionalidade sem observabilidade só é descoberta como quebrada pelo cliente.

## Três perguntas que o sistema precisa responder

1. **Está funcionando?** (saúde: o serviço responde, o job rodou, a integração sincronizou)
2. **Está funcionando bem?** (latência, taxa de erro, volume, atraso de fila)
3. **Por que quebrou?** (log estruturado com contexto suficiente para reconstruir o caso)

## Log

- **Estruturado**, não frase concatenada: evento, tenant, recurso, ator, duração, resultado.
- Níveis com significado: `debug` (desenvolvimento), `info` (fato de negócio relevante),
  `warn` (degradação recuperável), `error` (falha que exige ação).
- **Nunca** logar senha, token, credencial, corpo inteiro de payload sensível, ou PII desnecessária.
- Um identificador de correlação atravessa requisição → serviço → job → integração.
- Log de sucesso em operação de alto volume é custo; log de falha nunca é opcional.

## Alertas

Todo caminho abaixo emite alerta pelo mecanismo do projeto (nunca `console.log` engolido):

- falha de sincronização com sistema externo;
- job agendado que não rodou ou falhou;
- falha de autenticação/renovação de credencial de integração;
- erro em operação irreversível (estoque, fiscal, pagamento);
- configuração ausente que degrada silenciosamente o comportamento.

Alerta precisa de: origem (componente), severidade, mensagem acionável, e contexto estruturado.
Alerta que ninguém sabe o que fazer ao receber é ruído — escreva o runbook junto
(`docs/runbooks/`).

## Métricas úteis por tipo de funcionalidade

| Tipo | Medir |
|---|---|
| Endpoint | Volume, latência p95, taxa de erro por código |
| Job/cron | Última execução, duração, itens processados, itens falhados |
| Integração | Chamadas, taxa de erro por tipo, rate limit atingido, atraso de sincronização |
| Fila | Tamanho, idade da mensagem mais antiga, mensagens em dead-letter |
| Negócio | O número que a funcionalidade existe para mover |

## Saúde e diagnóstico

- Endpoint de saúde que checa dependências reais, não `return 'ok'`.
- Estado de sincronização por integração visível ao usuário/administrador (última execução,
  resultado, erro) — evita "por que meus pedidos não aparecem?".
- Erro que o usuário vê deve ter correspondência rastreável no log do servidor.

## Ao implementar uma fatia

- [ ] Falha de terceiro emite alerta, não some
- [ ] Log tem tenant e recurso, sem segredo
- [ ] Job novo registra início/fim/resultado
- [ ] Runbook criado ou atualizado quando o alerta é novo
