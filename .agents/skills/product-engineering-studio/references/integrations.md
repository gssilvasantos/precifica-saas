# Integrações externas

Todo serviço externo **vai** falhar, ficar lento, mudar o contrato sem avisar e devolver dado
inesperado. A integração é desenhada em torno disso.

## Antes de escrever a primeira chamada

- [ ] **Papel**: o externo é fonte da verdade, destino de escrita, ou gatilho? Nunca os três sem decisão explícita.
- [ ] **Autenticação**: OAuth, chave, HMAC? Onde a credencial é guardada (criptografada) e como é renovada?
- [ ] **Contrato**: endpoints usados, campos que importam, formato de erro, ambiente de sandbox.
- [ ] **Limites**: rate limit documentado, tamanho de página, janela de dados históricos.
- [ ] **Custo**: chamada cobrada? cota diária?

## Padrão de implementação

- **Adapter por provedor**, atrás de uma interface do projeto. O vocabulário do externo é
  traduzido para o vocabulário do domínio **dentro do adapter** — nunca vaza para o orquestrador.
- **Timeout** em toda chamada. Sem exceção.
- **Retry com backoff exponencial + jitter**, só para erro transitório (rede, 5xx, 429).
  Nunca faça retry de erro de validação (4xx) — é loop inútil.
- **Idempotência**: reprocessar não pode duplicar efeito. Use chave externa única no banco.
- **Deduplicação** de mensagens/webhooks repetidos.
- **Rate limiting de saída** respeitando a cota do provedor, compartilhado entre jobs.
- **Circuit breaker / degradação**: quando o externo está fora, o resto do produto continua
  funcionando com estado explícito ("não sincronizado desde X"), não com tela quebrada.

## Webhooks recebidos

1. Verificar assinatura **antes** de processar qualquer coisa.
2. Rejeitar replay (timestamp fora da janela, ID já processado).
3. Responder rápido (aceitar e enfileirar); processamento pesado fora do handler.
4. Idempotência por ID do evento externo.
5. Registrar o payload bruto quando o custo permitir — é a única prova quando o externo nega.

## Reconciliação

Sincronização incremental sempre diverge com o tempo. Preveja:

- Uma rotina de reconciliação completa (janela maior, comparação de estado).
- Uma forma de reprocessar um item específico manualmente.
- Visibilidade do que falhou e por quê (dead-letter ou tabela de erro consultável).

## Observabilidade da integração

Última sincronização bem-sucedida, contagem de sucesso/erro, tipo de erro, rate limit atingido,
credencial próxima de expirar. Falha de sincronização emite alerta.

## Honestidade

Se a integração **não foi exercitada contra o serviço real** (sem credencial, sem rede, sandbox
indisponível), diga isso explicitamente no relatório. Código que compila e passa em teste com
fake não é integração validada.

## Segurança

Credencial criptografada em repouso · nunca em log · escopo mínimo de permissão no app externo ·
URL de callback exata e em HTTPS em produção · validação do dado recebido como se fosse entrada
de usuário (porque é).
