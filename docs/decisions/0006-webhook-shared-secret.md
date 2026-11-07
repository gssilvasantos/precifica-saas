# ADR 0006 — Segredo compartilhado para webhooks sem assinatura própria

| | |
|---|---|
| **Status** | aceito |
| **Data** | 2026-10-20 |
| **Decisores** | Claude (agente), a pedido do usuário, a partir de achado de auditoria de segurança |
| **Escopo** | módulo (orders, fiscal) |

## Contexto

A auditoria de segurança (skill `api-security-review`, OWASP API Security Top 10, 20/10/2026)
encontrou que dois endpoints públicos aceitam notificações de terceiros sem qualquer verificação:

- `POST /api/webhooks/:channel` (`orders/interface/controllers/webhooks.controller.ts`) — recebido
  de Mercado Livre, Nuvemshop e Shopee. Mais grave que os outros: cada chamada dispara
  `OrderSyncOrchestrator.syncProvider()` de verdade, não é só passivo.
- `POST /api/fiscal/webhooks/focus-nfe` (`fiscal/interface/controllers/focus-nfe-webhook.controller.ts`)
  — recebido da Focus NFe, identifica a nota pelo campo `ref` do corpo.

Nenhum dos quatro provedores (Mercado Livre, Nuvemshop, Shopee, Focus NFe) garante, documentado e
verificável nesta integração, um cabeçalho de assinatura HMAC que pudéssemos validar
criptograficamente contra o payload — ao contrário de provedores como Stripe/GitHub, que assinam
cada webhook. Sem nenhuma verificação, qualquer um que descubra a URL (ou, no caso do Focus NFe,
adivinhe um `ref` válido) consegue chamar o endpoint.

## Decisão

Um segredo compartilhado único (`WEBHOOK_SHARED_SECRET`), verificado via query string
(`?secret=...`) por um guard reutilizável (`WebhookSecretGuard`, em `shared/security/`), aplicado
nos dois controllers via `@UseGuards`. O guard falha alto na inicialização se a variável de
ambiente não estiver configurada (mesmo princípio de `JWT_SECRET` e
`ERP_CREDENTIALS_ENCRYPTION_KEY`, corrigidos no mesmo lote).

**Por que query string, não path param:** a maioria dos provedores integrados não oferece campo
de cabeçalho customizado na configuração do webhook no próprio painel — só um campo de URL. Um
segredo na query string só exige acrescentar `?secret=...` na URL já cadastrada, em vez de
reestruturar a rota.

## Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Validar IP de origem (faixas publicadas pelo provedor) | Sem segredo para gerenciar | Faixas de IP mudam sem aviso; Mercado Livre e Shopee não publicam uma lista estável e versionada; Nuvemshop usa infraestrutura compartilhada (não é um IP fixo) | Frágil — quebraria silenciosamente quando o provedor trocasse de infraestrutura, e não cobre os 4 provedores de forma uniforme |
| HMAC por provedor (ex.: Nuvemshop `X-Linkedstore-Hmac-Sha256`) quando o provedor suportar | Verificação criptográfica real, ligada ao payload | Exige implementação e credencial própria por provedor; não documentado/confirmado para todos os 4 nesta auditoria | Correto como evolução futura **por provedor que realmente suportar isso** — não bloqueia a correção do gap imediato (gap existe nos 4, uma mitigação uniforme resolve os 4 agora) |
| Path param (`/webhooks/:channel/:token`) em vez de query string | Mesma proteção | Mudança de rota mais invasiva; nem todo painel aceita adicionar um segmento sem recriar a URL do zero | Query string é estritamente menos invasiva pro mesmo resultado |
| Nada (manter como estava) | Zero esforço | Endpoint de ação real sem nenhuma barreira — achado crítico da auditoria | Inaceitável dado o achado |

## Consequências

**Positivas**
- Fecha o gap de "qualquer um na internet com a URL consegue disparar sync real ou forjar
  atualização de nota fiscal".
- Mitigação única reaproveitada nos dois controllers (e em qualquer webhook futuro sem assinatura
  própria).

**Negativas / custo aceito**
- **Mudança operacional real, fora deste ambiente**: depois do deploy, é preciso entrar em CADA
  painel de desenvolvedor (Mercado Livre DevCenter, app Nuvemshop, app Shopee, painel Focus NFe) e
  acrescentar `?secret=<WEBHOOK_SHARED_SECRET>` na URL de notificação já cadastrada. Este agente
  não tem acesso a esses painéis (seria "tocar em serviço externo", vedado por
  `.claude/rules/security.md`) — essa reconfiguração manual é do usuário.
- Até essa reconfiguração ser feita em cada painel, as notificações desse canal são rejeitadas com
  403. **Isso é uma degradação graciosa, não uma quebra**: o sync de pedidos continua funcionando
  pelo scheduler de polling incremental (`OrderSyncOrchestrator`), só sem o "nudge" imediato do
  webhook — mais lento, não ausente. O Focus NFe não tem fallback de polling equivalente
  confirmado nesta auditoria; vale conferir se há consulta manual/agendada como contingência
  enquanto o painel não é reconfigurado.
- Não é uma assinatura HMAC real ligada ao payload — é um segredo compartilhado simples. Se o
  valor vazar, a mitigação cai; não protege contra um atacante que já tenha o segredo e o payload
  (replay). É uma barreira de "descoberta", não uma prova criptográfica de autenticidade do
  remetente.

**O que fica mais difícil depois desta decisão**
- Nada estrutural: o guard é independente por controller (`@UseGuards`), removível sem afetar
  outras rotas.

## Riscos

| Risco | Sinal de alerta | Plano se acontecer |
|---|---|---|
| Reconfiguração manual nos painéis é esquecida ou demorada | Logs de 403 repetidos em `/webhooks/*`/`/fiscal/webhooks/*`; sync de pedidos visivelmente mais lento que antes | Priorizar a reconfiguração de cada painel; enquanto isso, o polling agendado sustenta o sync (não é um incidente, é esperado) |
| `WEBHOOK_SHARED_SECRET` vaza (log, print, repositório público) | — | Rotacionar o valor e reconfigurar os 4 painéis de novo — mesmo processo de qualquer segredo rotacionado |

## Reversibilidade

Alta: remover o `@UseGuards(WebhookSecretGuard)` dos dois controllers volta ao estado anterior
(inseguro) imediatamente, sem mudança de schema ou de contrato de resposta.

## Referências

- Achado original: auditoria com a skill `api-security-review` (OWASP API10 — Unsafe Consumption
  of APIs), 20/10/2026.
- `.claude/rules/security.md` — "Nunca... tocar em serviço externo" (por que este agente não
  reconfigura os painéis sozinho) e a regra de falha alta na inicialização.
