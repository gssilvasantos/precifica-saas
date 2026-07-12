# Fase de Conexão Real e Interface de Operação (Sprint 23)

**Status:** cobre três entregas pedidas para esta sprint — (1) handshake de diagnóstico contra a API real do Mercado Livre, (2) observabilidade básica (alerta técnico em falha de renovação de token/sync), e (3) as duas primeiras telas de frontend que consomem dado real: Integrações (conexão OAuth2) e o draft de DRE por pedido.

## 1. Observabilidade básica — `AlertService`

Até esta sprint não existia nenhuma camada de observabilidade/alerta na plataforma (confirmado na Auditoria Técnica Consolidada, seção 6 — GAP Analysis). `shared/observability/` introduz o mínimo necessário para que uma falha de sync ou de renovação de token pare de depender de alguém checar o log manualmente:

- **`AlertService`** (`shared/observability/ports/alert-service.port.ts`) — porta com um único método, `emitAlert(alert: TechnicalAlert)`. `TechnicalAlert = { source, severity: 'WARNING' | 'ERROR', message, context? }`.
- **`ConsoleAlertService`** (implementação padrão) — loga com um prefixo fixo e grepável, `[ALERTA TÉCNICO] [source] mensagem {contexto}`, em `Logger.error` para `ERROR` e `Logger.warn` para `WARNING`. Não é Slack/PagerDuty/e-mail — é o mínimo para que uma ferramenta de log aggregation (Datadog, CloudWatch Logs Insights) já consiga filtrar/alertar em cima, sem nenhuma mudança de código.
- **`ObservabilityModule`** exporta só o token `ALERT_SERVICE` — quem emite um alerta nunca conhece `ConsoleAlertService` diretamente (Ports & Adapters, mesma disciplina do resto da plataforma). Trocar por um adapter real (Slack, PagerDuty) no futuro é um módulo novo, não uma reescrita dos chamadores.

**Onde `emitAlert` é chamado hoje:**

| Origem | Severidade | Quando |
|---|---|---|
| `OrderSyncOrchestrator` | `WARNING` | Falha ao processar um pedido individual (o lote continua) |
| `OrderSyncOrchestrator` | `ERROR` | Falha ao buscar pedidos do provider inteiro (todo o tenant/provider não sincronizou) |
| `MercadoLivreConnectionService` | `ERROR` | Falha ao renovar o access token (`refreshAccessToken` rejeitou) — a partir daqui o tenant fica sem acesso válido até intervenção manual |
| `MercadoLivreHandshakeService` | `ERROR` | Falha no diagnóstico de conexão (renovação ou busca de pedidos) |

## 2. Handshake de produção do Mercado Livre — `MercadoLivreHandshakeService`

**Decisão de arquitetura, importante:** este serviço é um diagnóstico **read-only**. Ele exercita a MESMA cadeia que a ingestão real usa — status → `getValidAccessToken` (renovação automática incluída) → `fetchOrders` real — mas **nunca persiste nenhum `Order`** nem emite eventos de domínio. A ingestão de verdade continua sendo o pipeline já existente (`OrderSyncOrchestrator`, disparado por `POST /orders/providers/:providerCode/sync` ou pelo scheduler). Misturar as duas coisas criaria um segundo caminho de escrita para a mesma tabela, com regras de deduplicação divergentes do orquestrador real.

**Endpoint:** `POST /marketplace-intelligence/mercado-livre/test-connection` (JWT, `ADMIN`).

**O que o resultado (`MercadoLivreHandshakeResult`) reporta:**
- `success` — se a cadeia inteira funcionou.
- `tokenRefreshed` — inferido comparando `lastRefreshedAt` do status antes/depois da chamada (prova que a renovação automática funciona de ponta a ponta, não só que um token já válido foi lido).
- `ordersFound` / `sampleOrderId` — evidência de que pedidos reais foram lidos da conta.
- `errorMessage` — motivo da falha, quando houver (nunca lança exceção para o chamador).

**Aviso de honestidade:** a cadeia OAuth2 (`exchangeCodeForToken`/`refreshAccessToken`/`fetchOrders`) foi implementada seguindo a documentação pública do Mercado Livre à risca, mas nunca foi exercitada contra credenciais de produção reais dentro deste ambiente de desenvolvimento (sandbox sem acesso de rede externo). Este endpoint é exatamente a ferramenta para validar isso pela primeira vez, uma vez implantado com `MERCADO_LIVRE_CLIENT_ID`/`SECRET` reais e uma conexão autorizada de verdade.

## 3. DRE por pedido — extensão aditiva de `DreReport`

O DRE (Etapa 20) só expunha agregados por canal (`DreChannelBreakdown[]`), suficiente para o gráfico comparativo do Dashboard, mas não para "ver cada pedido com seu próprio cálculo financeiro". `domain/dre-report.ts` ganhou um campo novo, **aditivo** (nada que já existia mudou de formato):

```ts
interface DreOrderLine {
  orderId, externalOrderId, channelCode, orderedAt;
  totalAmount;   // "Valor Total"
  feeAmount;     // "Taxas" — comissão do canal
  cmv;           // "CMV" — custo unitário resolvido x quantidade
  margemLiquida; // "Margem Líquida" — MESMA fórmula de waterfall do canal, por pedido
  dataQuality;   // INCOMPLETE se este pedido específico tem custo desconhecido/comissão suspeita
}

interface DreReport {
  // ...campos já existentes (channels, incompleteOrders, etc.), inalterados
  orderLines: DreOrderLine[]; // novo — ordenado por orderedAt desc
}
```

`margemLiquida` reaproveita a MESMA cadeia de cálculo de `computeChannelBreakdown` (receitaBruta − deduções − custos variáveis), aplicada a um pedido só — nunca uma fórmula financeira paralela. Nenhum endpoint novo foi necessário: `GET /financial-intelligence/dre` já devolve `orderLines` automaticamente, por ser parte do mesmo `DreReport`.

## 4. Frontend — as duas primeiras telas com dado real

- **Página de Conexão** (`routes/IntegracoesPage.tsx`) — substitui o placeholder "Coming Soon". Mostra badge Conectado/Desconectado, `sellerId`/`expiresAt`/última renovação quando conectado, botão "Conectar com Mercado Livre" (redireciona para `authorizeUrl`), "Testar conexão" (chama o handshake e mostra o resultado) e "Desconectar". Nuvemshop continua com um card honesto de "API-only, tela dedicada é o próximo passo" — não fingimos uma tela que não existe.
- **Draft do DRE** (`routes/FinanceiroPage.tsx`, nova rota `/financeiro`) — consome `GET /financial-intelligence/dre` e renderiza a tabela pedida: Pedido, Canal, Data, Valor Total, Taxas, CMV, Margem Líquida, mais um selo de qualidade (Completo/Aproximado) por linha. Respeita o Audit Mode (`useAppMode()`) como o resto do frontend — trocar Real/Demo nunca mistura amostra.

## 5. Gap honesto remanescente

- Observabilidade continua sendo só log estruturado — sem APM/tracing, sem métricas expostas (Prometheus), sem notificação ativa (e-mail/SMS/Slack). A porta `AlertService` já está pronta para essa troca ser um adapter novo.
- O handshake de produção real (contra uma conta de vendedor de verdade) não pôde ser validado a partir deste ambiente de desenvolvimento — precisa ser executado uma vez implantado com credenciais reais.
- O draft de DRE por pedido não tem paginação/filtro de período na UI ainda (o backend já suporta `dateFrom`/`dateTo` via `DreQuery`) — mostra o período padrão do `FinancialOrchestrator`.
