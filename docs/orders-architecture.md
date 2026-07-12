# Orders (Módulo de Pedidos) — Arquitetura

**Status:** primeira fatia funcional — contrato normalizado, hub multicanal (hoje: Nuvemshop), worklist com status unificado, sync incremental (polling + webhook-nudge) e integração automática com Contas a Receber. Emissão de NF-e/etiqueta ainda não existe — só o ponto de extensão (seção 8).

## 1. Por que um bounded context próprio

Pedido é o dado transacional que faltava para o resto da plataforma ter sentido: sem ele, Financial Intelligence não tem receita real, e Competition/Pricing Intelligence não têm como medir o efeito de uma decisão de preço em vendas de fato. Mesmo racional de bounded context dos módulos anteriores — schema Prisma próprio (`orders`), acoplado ao resto só via portas e eventos, nunca lendo/escrevendo tabela de outro módulo diretamente.

## 2. Contrato de dados — payload normalizado

Todo canal devolve pedidos já traduzidos para este formato (`RawOrderCandidate`, `shared/contracts/marketplace-provider.contract.ts`) — o adapter é o ÚNICO lugar que conhece o formato bruto do canal:

```ts
type UnifiedOrderStatus = 'EM_ABERTO' | 'PREPARANDO_ENVIO' | 'FATURADO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO';

interface RawOrderCandidate {
  externalOrderId: string;       // metade da chave de idempotência
  status: UnifiedOrderStatus;    // JÁ traduzido pelo adapter — nunca o status bruto do canal
  externalStatus: string;        // status bruto, preservado para auditoria
  subtotalAmount, shippingAmount, discountAmount, totalAmount: number;
  currency: string;
  shippingDeadlineAt?: Date;
  orderedAt: Date;
  paidAt?, shippedAt?, deliveredAt?, cancelledAt?: Date;
  items: { externalSku, productName, quantity, unitPrice, totalPrice }[];
  rawPayload?: unknown;          // payload cru — auditoria/depuração, nunca lido pelo domínio
}
```

Persistido como `Order` + `OrderItem[]` (schema `orders`). Rastreabilidade: `channelCode` (ex. `NUVEMSHOP`) + `externalOrderId` formam a chave natural (`@@unique([tenantId, channelCode, externalOrderId])`) — é o mesmo par usado por `ReceivableRecord.marketplaceSource` + `externalReference` na integração financeira (seção 5), então o link entre os dois módulos não precisa de uma tabela de mapeamento própria.

`OrderItem.skuCode` é referência SOLTA (nullable, nunca FK) — mesmo padrão de `ChannelListing.skuCode`/`CompetitiveOpportunity.skuCode`: um item cujo SKU não bate com nada do catálogo ainda entra no pedido (o pedido é fato consumado, não pode falhar por causa do catálogo estar incompleto).

## 3. Lógica do adaptador

`OrderCapableProvider` (extensão de `MarketplaceProvider`, capability `ORDERS`) expõe só `fetchOrders(ctx): Promise<RawOrderCandidate[]>`. `NuvemshopOrderProvider` (`erp-integration/infrastructure/nuvemshop/`) é a primeira implementação:

- Credenciais via `NuvemshopConnectionService.getDecryptedCredentials(tenantId)` — nunca decriptadas no provider.
- Paginação dentro de `NuvemshopApiClient.fetchOrders()` (mesmo estilo de `fetchAllProducts`: incrementa `page` até um lote menor que `per_page`), usando `updated_at_min` para sync incremental.
- Tradução de status isolada em uma função pura, `mapNuvemshopStatus()` (`nuvemshop-order-status.mapper.ts`), testada sem mocks.

**Aviso de honestidade:** a Nuvemshop não tem um estágio nativo de "Faturado" (emissão de NF-e é tipicamente uma integração fiscal separada). A heurística de MVP mapeia pedido pago-mas-não-despachado para `PREPARANDO_ENVIO`; `FATURADO` fica reservado para uma futura integração fiscal marcar explicitamente, ou atualização manual — nunca inferido às cegas.

Adicionar um canal novo (ML, Shopee...) = implementar `OrderCapableProvider`, adicionar ao array em `orders.module.ts` (`ORDER_CAPABLE_PROVIDERS`). `OrderProviderRegistry`/`OrderSyncOrchestrator` não mudam.

## 4. Schema de status unificado (mapeamento por canal, referência Olist)

6 estágios canônicos: `EM_ABERTO → PREPARANDO_ENVIO → FATURADO → ENVIADO → ENTREGUE`, mais o terminal `CANCELADO`. A tradução acontece EXCLUSIVAMENTE dentro do adapter de cada canal (nunca no orquestrador genérico) — mesma disciplina de Interface Segregation já usada para taxas.

| Estágio unificado | Nuvemshop (heurística atual) | Mercado Livre (mapeamento esperado, não implementado) |
|---|---|---|
| EM_ABERTO | `payment_status = pending` | `status = confirmed`, pagamento pendente |
| PREPARANDO_ENVIO | `payment_status = paid`, sem `shipping_status` de envio | `status = paid`, sem `shipping.status = shipped` |
| FATURADO | não inferido automaticamente (ver aviso acima) | idem — depende de integração fiscal |
| ENVIADO | `shipping_status = shipped` | `shipping.status = shipped` |
| ENTREGUE | `shipping_status = delivered` ou `status = closed` | `shipping.status = delivered` |
| CANCELADO | `status = cancelled` | `status = cancelled` |

## 5. Integração financeira — Order → Contas a Receber, sem duplicidade

`ReceivableFromOrderListener` (Financial Intelligence) assina `ORDER_EVENTS.PAID`/`ORDER_EVENTS.CANCELLED` — importa só `orders/domain/order-events.ts` (constantes + tipos), zero import de `OrdersModule` (mesma regra do resto da plataforma: assinar evento nunca exige import de módulo).

```
Order sai de EM_ABERTO (1ª vez)
        │  determineOrderTransitionEvents() [função pura, domain/order-transition-events.ts]
        ▼
ORDER_EVENTS.PAID { tenantId, channelCode, externalOrderId, totalAmount, paidAt }
        │
        ▼
ReceivableFromOrderListener.handleOrderPaid()
        │ 1. findByExternalReference(tenant, channelCode, externalOrderId) — MESMA chave natural do pedido
        │ 2. já existe? não faz nada (idempotência de evento)
        │ 3. não existe? create({ amount: totalAmount, expectedDate: paidAt (estimativa), marketplaceSource: channelCode, externalReference: externalOrderId })
        ▼
ReceivableRecord (status PENDING) — vira PAID de verdade só quando o relatório de
liquidação real chega (ReceivableReconciliationService, docs/financial-intelligence-architecture.md §3)
```

`ORDER_EVENTS.CANCELLED`: cancela o `ReceivableRecord` correspondente SE ainda `PENDING`. Se já está `PAID` (repasse já reconciliado), não cancela automaticamente — loga um alerta para tratamento manual (cenário de estorno, fora do escopo desta fatia; apagar a evidência de um valor já recebido seria pior que deixar uma inconsistência visível para o operador resolver).

"Pago" é inferido pela saída de `EM_ABERTO` (não pela presença de `paidAt`, que pode faltar em alguns canais) — heurística documentada em `domain/order-transition-events.ts`.

## 6. Estratégia de sincronização

**Polling incremental** é o mecanismo principal: `OrdersSyncSchedulerJob` roda a cada 10 minutos, consulta `ProviderSyncSchedule` (capability `ORDERS`) por providers vencidos, e chama `OrderSyncOrchestrator.syncProvider(providerCode)`. O orquestrador itera `provider.listTenantIdsToSync()` (pedido é sempre por tenant/loja) e busca uma janela de segurança de 7 dias via `since` a cada execução (sem watermark persistido por tenant ainda — extensão natural futura: persistir "última sincronização" por tenant, mesmo padrão de `NuvemshopConnection.lastSyncedAt`).

**Webhook** existe como um "nudge" em DOIS endereços equivalentes: `POST /orders/providers/:providerCode/webhook` (por código interno de provider, Etapa 16) e `POST /webhooks/:channel` (por `marketplaceCode`, ex. `/webhooks/nuvemshop`, Sprint 21 — ver seção 15). Ambos disparam o MESMO pipeline incremental ao receber a notificação do canal (nunca aplicam o payload do webhook diretamente). Isso é uma simplificação honesta de MVP — parsing dirigido pelo payload e validação de assinatura são específicos por canal e não foram implementados ainda; a alternativa seria maior latência (esperar o próximo ciclo do scheduler) e continuar 100% correta, então o nudge só reduz essa latência sem introduzir um caminho de escrita não validado.

**Paginação:** responsabilidade do adapter (nunca do orquestrador) — cada `fetchOrders()` devolve a lista completa da janela pedida.

**Duplicidade:** evitada pela chave natural `(tenantId, channelCode, externalOrderId)` — upsert, nunca insert. `OrderRepository.upsert()` devolve `previousStatus` (o estado ANTES do upsert), permitindo detectar transição sem uma segunda query.

## 7. Interface do usuário — worklist (Olist-style)

**Tabela de colunas** (worklist principal, `GET /orders`):

| Coluna | Origem | Nota |
|---|---|---|
| Canal (badge) | `channelCode` | ver mapeamento de ícone abaixo |
| Nº do pedido | `externalOrderId` | link para o detalhe |
| Cliente | (fora do escopo desta fatia — `RawOrderCandidate` não captura dados do comprador ainda) | extensão futura aditiva |
| Data do pedido | `orderedAt` | |
| Prazo de despacho | `shippingDeadlineAt` | destaque visual (vermelho) quando vencido e status ainda não `ENVIADO`/`ENTREGUE` |
| Valor total | `totalAmount` + `currency` | |
| Itens | contagem de `items[]`, com tooltip do detalhe | |
| Status | badge dos 6 estágios unificados | cor por estágio, mesma paleta do `buyBoxStatus` já usado em Competition Intelligence |

**Abas de status:** `GET /orders/status-counts` devolve os 6 contadores em uma única query (`GROUP BY status`), preenchendo 0 para status sem pedido — nunca uma query por aba.

**Badge de canal:** `channelCode` é uma string estável (`NUVEMSHOP`, `MERCADO_LIVRE`...) — o frontend mantém um mapa local `channelCode → { label, logoUrl }` (não precisa vir do backend; é dado estático de apresentação). Se o número de canais crescer o suficiente para justificar, isso pode migrar para um endpoint de metadados, mas hoje seria over-engineering para 1-2 canais reais.

**Performance com centenas de pedidos:** paginação real no banco (`OrderRepository.findWithFilters` usa `WHERE` + `skip/take` do Prisma, nunca filtro em memória — diferente de cadastros pequenos como Product/Packaging) + os contadores de aba vêm de uma query agregada separada, então trocar de aba é só trocar o filtro `status` da paginação (nova página de dados), não recarregar tudo. Recomendação de frontend (fora do escopo de backend desta fatia): paginação por página fixa (ex. 50 itens) em vez de scroll infinito ou virtualização — o volume esperado de um MVP (centenas, não dezenas de milhares, por tenant) não justifica a complexidade de uma lista virtualizada ainda; se o volume crescer, essa é uma troca isolada no componente de tabela, sem tocar no contrato da API.

## 8. Integração operacional — gatilho para NF-e/etiqueta

`ORDER_EVENTS.READY_FOR_FULFILLMENT` é emitido quando um pedido entra em `PREPARANDO_ENVIO` (função pura `determineOrderTransitionEvents`). É um ponto de extensão explícito, sem consumidor ainda: um futuro módulo fiscal/logístico assinaria esse evento (`orders/domain/order-events.ts`, zero import de módulo) para acionar emissão de NF-e ou impressão de etiqueta, exatamente como `ReceivableFromOrderListener` já assina `PAID`/`CANCELLED` hoje.

## 9. Endpoints

```
GET  /orders?channelCode=&status=&dateFrom=&dateTo=&page=&pageSize=   — worklist paginada
GET  /orders/status-counts                                             — contadores das 6 abas
GET  /orders/:id                                                       — detalhe de um pedido
POST /orders/providers/:providerCode/sync      [ADMIN]                 — sincronizar agora
POST /orders/providers/:providerCode/webhook                            — nudge de sync por provider (ver seção 6)
POST /webhooks/:channel                                                 — nudge de sync por canal (Sprint 21, ver seção 14)
```

## 11. Etapa 17 — escalabilidade para um hub multicanal real (7 marketplaces)

Esta seção responde diretamente às 4 perguntas de arquitetura sobre integrar Nuvemshop, Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu e SHEIN sem que adicionar um canal novo exija tocar no núcleo.

### 11.1 Q1 — Extensibilidade do `MarketplaceProvider`

**Isso já existe e é o modelo usado por toda a plataforma desde a Etapa 4/5: Interface Segregation, não uma classe "faz tudo".** `MarketplaceProvider` (`shared/contracts/marketplace-provider.contract.ts`) é a base mínima (`code`, `marketplaceCode`, `capabilities[]`, `healthCheck()`); cada capacidade real é uma interface de extensão separada:

```
MarketplaceProvider (base)
 ├─ FeeRuleCapableProvider    → fetchFeeRules()
 ├─ ListingCapableProvider    → listActiveListings()
 ├─ PriceUpdateCapableProvider→ updatePrice()
 └─ OrderCapableProvider      → fetchOrders()   ← a que interessa aqui
```

Adicionar SHEIN como canal de pedidos, na prática:

1. Criar `SheinOrderProvider implements OrderCapableProvider`, com `capabilities = [ProviderCapability.ORDERS]`.
2. Implementar `fetchOrders(ctx)`, que internamente resolve as 3 responsabilidades que a pergunta pede — todas DENTRO do adapter, nunca vazando para o orquestrador:
   - **(a) Buscar pedidos:** um `SheinApiClient` próprio (mesmo papel de `NuvemshopApiClient`), com sua própria paginação e seu próprio `RateLimiter` (seção 11.3).
   - **(b) Mapear status:** uma função pura `mapSheinStatus()` (mesmo padrão de `mapNuvemshopStatus()`, testável sem mocks), que traduz o vocabulário da SHEIN para os 6 estágios canônicos de `UnifiedOrderStatus`.
   - **(c) Processar taxas:** o cálculo de `feeAmount`/`netAmount` da comissão da SHEIN, dentro de `tryNormalize()` (seção 11.2).
3. Registrar a nova instância no array `ORDER_CAPABLE_PROVIDERS` de `orders.module.ts`.

Nenhum desses passos toca `OrderSyncOrchestrator`, `OrderRepository`, `ReceivableFromOrderListener` ou qualquer schema além de credenciais. `OrderProviderRegistry` descobre o provider pela lista injetada (DI), e `OrderSyncOrchestrator` só conhece a interface `OrderCapableProvider` — nunca uma classe concreta de canal. Isso é literalmente o mesmo mecanismo que já vale para `FeeRuleCapableProvider` desde a Etapa 4 (documentado em `docs/marketplace-intelligence-architecture.md`, seção 3); a Etapa 17 não inventa um modelo novo, confirma que o existente escala para 7 canais sem alteração estrutural.

### 11.2 Q2 — Normalização financeira sem if/else

O ponto-chave: **quem calcula `feeAmount`/`netAmount` é sempre o adapter, nunca um serviço central.** `RawOrderCandidate` (o contrato que todo adapter devolve) já inclui os dois campos calculados:

```ts
feeAmount: number;  // comissão do marketplace deduzida deste pedido — 0 é um valor válido (ex.: Nuvemshop)
netAmount: number;  // o que o vendedor de fato recebe — é ISSO que alimenta ReceivableRecord.amount
```

O fluxo completo: `RawOrderCandidate.netAmount` → `OrderUpsertData.netAmount` → `Order.netAmount` (persistido) → `OrderPaidEvent.netAmount` → `ReceivableFromOrderListener.handleOrderPaid()` lê `payload.netAmount` incondicionalmente:

```ts
await this.receivables.create({
  amount: payload.netAmount,   // nunca payload.totalAmount, nunca um switch(channelCode)
  ...
});
```

Cada canal resolve sua própria estrutura de comissão dentro do seu `tryNormalize()`: Nuvemshop hoje devolve `feeAmount: 0, netAmount: totalAmount` (é a loja própria do vendedor — não há comissão de marketplace; a única dedução real é a taxa do gateway de pagamento, que já é um mecanismo agregado separado, `NuvemshopFeeRuleProvider`, usado no cálculo de Floor Price, não uma dedução por pedido). Um adapter futuro de Mercado Livre calcularia `feeAmount` a partir do percentual de comissão da categoria do produto; Shopee, de uma tabela fixa por categoria; Amazon, do "referral fee" + eventuais tarifas de FBA — cada um com sua própria lógica, isolada no próprio arquivo, sem que `ReceivableFromOrderListener` precise saber que essas diferenças existem. Isso é o que a pergunta pede: nenhuma condição `if (channelCode === 'SHOPEE')` no código financeiro.

### 11.3 Q3 — Rate limiting por marketplace

Módulo novo, `shared/rate-limiting/`, com 3 peças, cada uma reaproveitável por qualquer client de canal:

- **`RateLimiter`** (token bucket): `schedule<T>(fn: () => Promise<T>): Promise<T>` — enfileira e libera a chamada quando há um token disponível, bloqueando com `sleep()` (nunca busy-loop). Genérico, sem saber o que é Nuvemshop ou Amazon.
- **`marketplace-rate-limits.ts`**: registro `MARKETPLACE_RATE_LIMITS: Record<string, RateLimiterConfig>` — um canal novo declara sua cota real aqui (uma linha), com um `DEFAULT_RATE_LIMIT` conservador (1 req/s) como fail-safe para qualquer canal sem entrada explícita.
- **`with-retry.ts`**: `withRetry()` genérico com backoff + `isRateLimitError()` (reconhece HTTP 429) — usado quando, mesmo com o throttle preventivo do `RateLimiter`, o canal ainda devolve 429 (limite mais estrito que o documentado, ou outro processo/tenant consumindo a mesma cota).

**Decisão de design deliberada: quem possui o `RateLimiter` é o API CLIENT de cada canal (`NuvemshopApiClient`, e futuramente `MercadoLivreApiClient`, `ShopeeApiClient`...), nunca o `OrderSyncOrchestrator`.** O orquestrador itera providers e tenants e chama `fetchOrders()` sem saber que rate limiting existe — exatamente o mesmo racional já usado para paginação (seção 3/6: cada adapter pagina internamente, o orquestrador só vê a lista final). Isso significa que gerenciar 7 marketplaces diferentes não exige um "orquestrador de rate limit" central com uma tabela de configuração por canal condicionada por `if/switch` — é 7 instâncias independentes de `RateLimiter`, cada uma configurada com a cota real do seu canal, vivendo dentro do client que efetivamente faz as chamadas HTTP.

Integração de referência em `NuvemshopApiClient`: todo `fetch()` passa por um método privado `request()`, que primeiro agenda via `rateLimiter.schedule()` e depois envolve com `withRetry({ shouldRetry: isRateLimitError })` — throttle preventivo primeiro, retry reativo depois (nunca o contrário; retry sem throttle só adicionaria pressão a uma API já saturada).

**Simplificação consciente, não "perfeição":** o bucket de `NuvemshopApiClient` hoje é GLOBAL à instância do client — todos os tenants que usam Nuvemshop nesta plataforma compartilham a mesma cota. Isso é seguro por construção (nunca estoura o limite real do canal), mas significa que um tenant com sync pesado pode consumir mais da cota compartilhada e atrasar o sync de outro tenant do mesmo canal. Não é uma falha de isolamento de ERRO (um tenant não quebra o sync de outro), mas é contenção de RECURSO — uma distinção real que vale nomear em vez de ignorar. Refinamento natural, se o volume multi-tenant justificar: um `RateLimiter` por `storeId` em vez de um único por client.

### 11.4 Q4 — Campos fiscais no contrato normalizado

`RawOrderCandidate` ganhou 3 campos, todos opcionais (nenhum adapter é obrigado a preenchê-los, e o repositório aplica um default seguro quando ausentes):

```ts
fiscalResponsibility?: 'SELLER' | 'MARKETPLACE'; // quem deve emitir a NF-e deste pedido (default: SELLER)
buyerTaxId?: string;                              // CPF/CNPJ do comprador — necessário para emissão de NF-e
invoiceNumber?: string;                            // número/chave de acesso da NF-e, quando já emitida pelo canal
```

Mais um campo em `RawOrderItemCandidate.taxAmount?: number` — imposto discriminado POR ITEM, porque a legislação fiscal brasileira exige a quebra por item, não só um total por pedido.

O motivo de existirem: alguns programas de venda da Amazon (Fulfillment by Amazon com "Amazon como vendedor de registro" em certas modalidades) e da Magalu (Magalu Entrega/Fulfillment) fazem o MARKETPLACE emitir a nota fiscal em nome do vendedor, ou assumir a nota diretamente — isso muda qual sistema deveria gerar a NF-e e é uma diferença estrutural real entre canais, não um detalhe cosmético. `fiscalResponsibility` é o campo que permite ao Kyneti (numa fase futura de emissão fiscal) decidir "eu preciso emitir essa nota" vs. "o marketplace já emitiu, só preciso registrar `invoiceNumber`" sem um `if (channelCode === 'AMAZON')` espalhado pelo código fiscal — mesma disciplina de normalização de Q2, aplicada a um domínio diferente.

**Honestidade sobre o estado atual:** nenhum desses 3 campos é preenchido pelo `NuvemshopOrderProvider` hoje — a Nuvemshop não expõe esse dado no payload padrão de pedido, e como é a loja própria do vendedor, `fiscalResponsibility` sempre é `SELLER` (aplicado como default pelo repositório, não pelo adapter). Amazon/Magalu, quando implementados, populariam os 3 campos de verdade a partir do payload de cada API.

## 12. Por que este modelo evita alteração estrutural ao adicionar um canal

Resumo prático de "plugar = configuração + adapter, nunca mudança de núcleo": os arquivos que mudam ao adicionar um canal (ex. Mercado Livre) são só (1) um novo `MercadoLivreApiClient` com seu próprio rate limiter, (2) um novo `MercadoLivreOrderProvider implements OrderCapableProvider`, (3) uma função pura `mapMercadoLivreStatus()`, (4) uma linha nova em `MARKETPLACE_RATE_LIMITS`, e (5) uma linha nova no array `ORDER_CAPABLE_PROVIDERS` de `orders.module.ts`. Nenhum desses toca `OrderSyncOrchestrator`, `OrderRepository`, `ReceivableFromOrderListener`, os schemas de Financial Intelligence, ou o contrato `RawOrderCandidate` em si (que já é genérico o bastante para os 7 canais listados).

Sobre a moldura de "por que isso garante a perfeição" da pergunta original — vale confirmar o que é verdadeiro e ser preciso sobre o que não é:

- **Isolamento de erro, verdadeiro:** `OrderSyncOrchestrator.syncTenant()` tem try/catch por tenant (uma falha na Amazon não impede o sync de outro canal) E por pedido individual dentro do loop (`upsertAndEmit`, seção 3) — um pedido malformado não derruba os demais do mesmo lote. Se a API da Amazon cair, `health.recordFailure()` registra o problema, o log de sync marca `FAILED`, e o restante do sistema (Contas a Receber, outros canais, Pricing/Competition Intelligence) continua operando normalmente. Isso é real, não é só teoria.
- **Consistência de dados, verdadeiro para o campo `netAmount`:** como descrito em 11.2, `ReceivableFromOrderListener` processa o valor líquido de qualquer canal exatamente do mesmo jeito, porque o valor já chega calculado. Essa parte da afirmação do usuário é exatamente o que o código faz.
- **Ressalva que vale nomear (nem tudo é isolamento perfeito):** o rate limiter do `NuvemshopApiClient` é um bucket global por client, não por tenant — contenção de recurso entre tenants do mesmo canal é possível, mesmo sem quebra de funcionalidade (seção 11.3). "Perfeição" é uma palavra forte para uma arquitetura que, mesmo bem desenhada, ainda tem um trade-off documentado dessa natureza. O modelo é sólido e extensível pelo desenho (Interface Segregation + eventos + contrato normalizado); não é uma garantia absoluta de que nada nunca vai vazar entre canais/tenants em nenhuma circunstância.

## 13. Etapa 19 — Orquestração de Custos: margem real por pedido

Pedido de arquitetura: habilitar cálculo de margem real (não só o `netAmount` da Etapa 17, que é receita após comissão do canal — um eixo diferente de lucro após custo de aquisição).

**Correção de premissa:** `Product.costPrice` já existe desde a Etapa 2 (`prisma/migrations/20260711111209_pricing_decision`), é `Decimal` **obrigatório** (não nullable) e já é consumido pelo Pricing Engine via `ProductCatalogReader.findBySku` (que devolve o custo EFETIVO — produto + embalagem, ver seção 9 do `pricing-intelligence-architecture.md`). Não havia nada para adicionar ali. O que faltava de fato era o Módulo de Pedidos capturar o custo NO MOMENTO DA VENDA — hoje `Order`/`OrderItem` não sabiam nada sobre custo, só sobre preço de venda e comissão do canal.

**Contrato (Typescript):** `OrderItem.costPrice: number | null` e `OrderItemUpsertData.costPrice?: number` (`domain/order.entity.ts`) — o "OrderLineItem" do pedido original é `OrderItem` neste código. Deliberadamente **não** foi adicionado a `RawOrderItemCandidate` (o contrato do adapter, `marketplace-provider.contract.ts`): custo de aquisição é dado NOSSO, nenhum marketplace o conhece ou deveria fornecê-lo — aceitar isso do canal abriria a porta para um canal mal-intencionado ou com bug inflar/deflar a margem reportada. O snapshot é capturado pelo `OrderSyncOrchestrator`, no mesmo lookup que já resolve `skuCode` via `ProductCatalogReader` (`upsertAndEmit`, seção 3) — sem nenhuma chamada extra ao catálogo.

**Migração:** este ambiente de sandbox não tem Postgres real nem acesso de rede para baixar os binários de engine do Prisma (limitação pré-existente, documentada desde a Etapa 8), então `npx prisma migrate dev` não pôde ser executado interativamente. A migração (`prisma/migrations/20260711130000_order_cost_and_fiscal_catchup/migration.sql`) foi escrita à mão para refletir exatamente o diff que o Prisma geraria — e cobre, de propósito, não só `OrderItem.costPrice` novo, mas também os campos da Etapa 17 (`Order.feeAmount/netAmount/fiscalResponsibility/buyerTaxId/invoiceNumber`, `OrderItem.taxAmount`) que ficaram no `schema.prisma` sem uma migração correspondente (mesma limitação de rede impediu `migrate dev` naquela etapa). Todas as colunas novas são `NULL`-áveis ou têm `DEFAULT` — nenhuma linha de `Order`/`OrderItem` pré-existente é perdida ou quebra.

**Fallback de cálculo de margem (`domain/order-margin.ts`, puro, sem mocks):**

```
resolveItemCostPrice(item, currentProductCostPrice):
  item.costPrice !== null       -> { costPriceUsed: item.costPrice,        costSource: 'ITEM_SNAPSHOT'   }
  currentProductCostPrice !== null -> { costPriceUsed: currentProductCostPrice, costSource: 'CURRENT_PRODUCT' }
  nenhum dos dois               -> { costPriceUsed: null,                 costSource: 'UNKNOWN'         }
```

Isso é exatamente o fallback pedido ("se o costPrice do produto for nulo, utilize o custo atual do produto"), com uma correção de modelagem importante: quem pode ser nulo não é `Product.costPrice` (sempre obrigatório), é o SNAPSHOT no item do pedido — pedidos sincronizados antes desta etapa, ou itens cujo SKU nunca resolveu contra o catálogo. `OrdersService.getMarginSummary(tenantId, id)` (novo, `GET /orders/:id/margin`) monta esse fallback: busca o pedido, identifica só os SKUs de itens SEM snapshot, consulta `ProductCatalogReader` uma única vez por SKU (não por item — dois itens do mesmo SKU não duplicam a consulta), e agrega via `computeOrderMarginSummary`.

**Prioridade de integridade de dados, cumprida de duas formas:**
- Nenhuma venda existente "quebra": pedidos antigos continuam com `netAmount`/`totalAmount` intactos (Etapa 17, inalterados); a margem por custo é um dado NOVO e aditivo, nunca substitui ou recalcula algo que já existia.
- Nenhum número é fabricado: quando nem o snapshot nem o custo atual do produto existem (SKU nunca cadastrado), o item entra como `costSource: 'UNKNOWN'` e é EXCLUÍDO dos totais agregados (`itemsWithUnknownCost` sinaliza quantos) — a alternativa de tratar como custo zero inflaria artificialmente a margem reportada, o que seria pior que simplesmente admitir "não sei".

**Endpoint:** `GET /orders/:id/margin` devolve `OrderMarginSummary` (margem por item + `costSource` de cada um + totais agregados). Não populado ainda por nenhuma tela do frontend — ponto de extensão pronto, mesmo padrão de `ORDER_EVENTS.READY_FOR_FULFILLMENT`.

## 14. Sprint 21 — Conexão de Canais Core: Mercado Livre (ORDERS) + webhook por canal

Pedido de Senior Integration Engineer: adaptadores de ingestão de pedidos para Nuvemshop e Mercado Livre, um `src/adapters/` com `Client` por canal, o `OrderSyncOrchestrator` fazendo a normalização para `RawOrderCandidate`, `POST /webhooks/:channel`, log de auditoria por tentativa de sync, e interfaces para plug-and-play de Shopee/TikTok no futuro.

**O que já existia (nada foi reconstruído):** Nuvemshop (`NuvemshopClient` = `NuvemshopApiClient`, `NuvemshopOrderProvider`) já estava pronto desde a Etapa 16. `OrderCapableProvider` (`shared/contracts/marketplace-provider.contract.ts`) **já é** a interface de plug-and-play pedida no item 1 — é o que a seção 12 já documentava como a receita para adicionar um canal sem alterar núcleo. `OrderSyncOrchestrator` **já existe** desde a Etapa 16 e já é 100% agnóstico de formato de canal; e o log de auditoria por tentativa (`ProviderSyncLogRepository.start/finish`, com `status`/`errorDetails`) **já existe** desde a mesma etapa — toda falha de conexão/autenticação já vira uma entrada consultável, sem exigir nenhum código novo.

**Três correções de premissa:**

1. **Não existe `src/adapters/`.** A plataforma organiza cada canal por bounded context: clients/providers de canal moram dentro do módulo dono da integração (`erp-integration/infrastructure/nuvemshop/`, `marketplace-intelligence/infrastructure/providers/mercado-livre/`), nunca em uma pasta técnica cross-module — criar `src/adapters/` duplicaria essa organização e quebraria a disciplina de bounded context usada em toda a plataforma desde a Etapa 3. `MercadoLivreOrderProvider` foi colocado ao lado de `MercadoLivreFeeRuleProvider` (mesmo canal, mesma pasta), como classe separada (mesmo racional de `NuvemshopOrderProvider` vs `NuvemshopFeeRuleProvider`: capacidades independentes, nada obriga uma classe só).
2. **"OrderSyncOrchestrator normaliza a resposta bruta" — não é bem assim.** A normalização (`raw -> RawOrderCandidate`) é responsabilidade EXCLUSIVA de cada adapter (`NuvemshopOrderProvider.tryNormalize`, e agora `normalizeMercadoLivreOrder`), nunca do orquestrador — que só sabe fazer upsert idempotente + detectar transição + emitir evento, igual para qualquer canal. Centralizar a normalização no orquestrador exigiria um `if (channelCode === X)` ali dentro, exatamente o acoplamento que a arquitetura evita desde a Etapa 16.
3. **Mercado Livre não pode ter pedidos sincronizados de verdade ainda — gap real, não só estrutura.** Diferente da Nuvemshop (app privado, credencial única gerada no painel), o Mercado Livre exige **OAuth2 completo por vendedor** (authorize + callback + refresh token) para listar pedidos — infraestrutura que não existe (não há `MercadoLivreConnection`, equivalente a `NuvemshopConnection`). Implementar isso de fachada seria pior que não implementar: pareceria funcionar e nunca devolveria pedido nenhum, silenciosamente. Por isso `MercadoLivreOrderProvider` segue o MESMO padrão de honestidade já usado em `listActiveListings`/`updatePrice` (Etapa 8): estrutura completa, registrada e testável, mas `ensureValidCredentials()` lança `NotImplementedException` antes de qualquer chamada de rede.

**O que foi construído de verdade nesta sprint:**

```
modules/marketplace-intelligence/infrastructure/providers/mercado-livre/
  mercado-livre-api.client.ts          + fetchOrders() (paginação offset/limit, pronto mas inalcançável até OAuth2)
  mercado-livre-order-status.mapper.ts   (novo, puro, testável — mapeia status/shipping.status -> UnifiedOrderStatus)
  mercado-livre-order-normalizer.ts      (novo, puro, testável — raw -> RawOrderCandidate; nunca fabrica shippedAt/deliveredAt sem data real no payload)
  mercado-livre-order.provider.ts        (novo — implements OrderCapableProvider + AuthenticatedProvider; listTenantIdsToSync() -> [] honesto; fetchOrders() lança)
```

Registrado em `MarketplaceIntelligenceModule` (provider + export) e consumido por `OrdersModule` (novo import do módulo, `ORDER_CAPABLE_PROVIDERS` passa a ter 2 entradas) — **zero mudança** em `OrderSyncOrchestrator`, `OrderProviderRegistry`, `OrderRepository` ou no contrato `RawOrderCandidate`, confirmando a seção 12 na prática, não só na teoria.

**Webhook por canal:** `OrderProviderRegistry.findByMarketplaceCode(marketplaceCode)` (novo método, case-insensitive) resolve todos os providers ORDERS-capable de um canal. `WebhooksController` (`POST /webhooks/:channel`, novo módulo `orders/interface/controllers/webhooks.controller.ts`) é uma FACHADA sobre o webhook por provider já existente (seção 6) — endereça por nome de canal amigável (o que o lojista configuraria no painel do marketplace), delega para `OrderSyncOrchestrator.syncProvider()` para cada provider encontrado, canal desconhecido responde 404. Nenhuma lógica de sync duplicada.

**Log de auditoria (item 4 do pedido) — já resolvido, reforçado pela cobertura nova:** `ProviderSyncLogRepository.start/finish` já grava uma entrada por tentativa de sync (por tenant + provider), com `status: SUCCESS | FAILED | PARTIAL` e `errorDetails` quando falha — isso JÁ conecta com a Regra de Ouro da Etapa 20 (dado incompleto rastreável): uma falha de conexão/autenticação vira uma linha auditável, nunca um silêncio. A prova concreta desta sprint: assim que `MercadoLivreOrderProvider` for de fato exercitado pelo scheduler (quando o OAuth2 existir), sua falha de credencial vai aparecer no mesmo log com a mensagem clara de `NotImplementedException` — nenhuma peça nova de logging precisou ser construída.

**O que faltava para Mercado Livre ORDERS funcionar de verdade** (lista original desta seção) **foi resolvido na Sprint 22** — `MercadoLivreConnection` (OAuth2 completo: authorize/callback/refresh automático) existe e `MercadoLivreOrderProvider` consome a conexão real em vez de lançar `NotImplementedException`. Ver `docs/auth-security.md` para o fluxo completo e `README.md` (Sprint 22) para o resumo.

Testes novos: `mercado-livre-order-status.mapper.spec.ts` (10 casos), `mercado-livre-order-normalizer.spec.ts` (mapeamento completo, sale_fee somado sem inventar valor, sem fabricar datas de envio/entrega), `mercado-livre-order.provider.spec.ts` (capacidade declarada, `listTenantIdsToSync` honesto, gate de credencial nunca chama o client — reescrito na Sprint 22 para o comportamento real com OAuth2), `order-provider-registry.service.spec.ts` (novo — `findByCode`/`findByMarketplaceCode`, 1:N por canal), `webhooks.controller.spec.ts` (resolução por canal, múltiplos providers, canal desconhecido, payload nunca lido).

## 15. O que fica para uma próxima fatia

- Watermark de `since` persistido por (tenant, provider) — hoje é uma janela fixa de 7 dias a cada execução.
- Dados do comprador (nome, documento, endereço de entrega) — não capturados ainda; aditivo ao contrato quando pedido.
- Verificação de assinatura de webhook por canal + parsing dirigido pelo payload (hoje é só um nudge, seção 6).
- `FATURADO` automático via integração fiscal real.
- Mercado Livre ORDERS operacional desde a Sprint 22 (OAuth2 completo, ver `docs/auth-security.md`). Providers para Shopee/TikTok Shop/Amazon/Magalu/SHEIN seguem só com a estrutura pronta desde a Etapa 17, sem implementação nem conexão.
- Rate limiter por `storeId`/conta em vez de global por client, se o volume multi-tenant justificar (seção 11.3).
- Emissão de NF-e real consumindo `fiscalResponsibility`/`buyerTaxId`/`invoiceNumber`/`OrderItem.taxAmount` — hoje são só os campos do contrato, sem consumidor ainda (mesmo padrão de extensão do `ORDER_EVENTS.READY_FOR_FULFILLMENT`, seção 8).
- Frontend consumindo `GET /orders/:id/margin` (Etapa 19) — hoje só o backend existe; a tabela de pedidos do `apps/web` (Etapa 18) ainda mostra só `netAmount`, não a margem por custo.
- `npx prisma migrate dev` real (com Postgres/rede disponíveis) para confirmar que a migração escrita à mão (`20260711130000_order_cost_and_fiscal_catchup`) bate exatamente com o diff que o Prisma geraria — ela foi cuidadosamente escrita para isso, mas nunca foi executada de fato neste ambiente.
