# Financial Intelligence — Arquitetura

**Status:** cadastro de despesas fixas, Contas a Receber, reconciliação manual de repasses, reprecificação reativa a mudança de custo de embalagem e (Etapa 20) DRE em tempo real por canal. Projeção de Fluxo de Caixa (o objetivo declarado de longo prazo) ainda não existe — ver seção 6.

## 1. Por que um bounded context próprio, não uma extensão do Catalog

`FixedExpense`/`ReceivableRecord` são sobre a saúde financeira do NEGÓCIO (despesas recorrentes, repasses de marketplace) — não sobre o cadastro de produto. Mesma disciplina do resto da plataforma (Competition Intelligence não vive dentro de Catalog, Marketplace Intelligence não vive dentro de erp-integration): um bounded context por responsabilidade, acoplado só via portas.

Reaproveitamento explícito, para registro: **`Packaging` já existia** (Etapa 14, ver seção 9 de `docs/pricing-intelligence-architecture.md`) — cadastro, vínculo ao `Product`, e custo efetivo (`Product.costPrice + Packaging.costPrice` via `ProductCatalogReader`) já estavam implementados antes deste pedido. Nada foi reconstruído; esta etapa **estende** aquele trabalho com a peça que faltava — reprecificação reativa (seção 4) — e adiciona os dois módulos novos (DRE, Contas a Receber).

## 2. Schema

```prisma
model FixedExpense {
  id, tenantId, name, amount, recurrenceType (MONTHLY|WEEKLY|YEARLY|ONE_TIME), dueDay, isActive
}

model ReceivableRecord {
  id, tenantId, amount, status (PENDING|PAID|OVERDUE|CANCELLED)
  expectedDate, paidAt
  marketplaceSource   // canal de origem — string, não enum, mesmo racional de Marketplace.code
  externalReference   // order id/settlement id no marketplace — chave de reconciliação
  skuCode             // referência SOLTA (não FK), só para permitir DRE "por produto" no futuro
}
```

`FixedExpense` é CONFIGURAÇÃO (uma linha por despesa cadastrada, a recorrência é um campo, não uma linha por mês); `ReceivableRecord` é TRANSACIONAL (uma linha por repasse esperado). Índices: `[tenantId, status, expectedDate]` (consulta "meu A Receber") e `[tenantId, marketplaceSource, externalReference]` (a chave usada pela reconciliação).

## 3. Reconciliação de repasses — como um JSON/CSV vira `ReceivableRecord.status = 'PAID'`

Mesmo padrão arquitetural de `ICompetitionRadar`/`MarketplaceProvider`: uma abstração agnóstica de formato, `SettlementReportParser` (`shared/contracts/settlement-report-parser.contract.ts`), registrada num registry multi-provider (`SettlementParserRegistry`, token `SETTLEMENT_REPORT_PARSERS`) — adicionar suporte a um novo marketplace é registrar mais um parser, nunca alterar o serviço de reconciliação.

```
POST /financial-intelligence/settlements/import { marketplaceCode, format, fileContent }
        │
        ▼
ReceivableReconciliationService.reconcile(tenantId, marketplaceCode, fileContent, format)
        │ 1. SettlementParserRegistry.findByMarketplaceCode(marketplaceCode)
        │ 2. parser.parse(fileContent, format) -> RawSettlementEntry[] (externalReference, amount, settledAt)
        │ 3. para cada entry: ReceivableRecordRepository.findByExternalReference(tenant, marketplaceCode, ref)
        │ 4. se achou e status != PAID -> markPaid + emite RECEIVABLE_PAID
        ▼
{ matched, alreadyReconciled, unmatchedReferences }  // resultado de negócio, nunca exceção
```

**Honestidade técnica:** hoje o único parser registrado é `GenericSettlementParser` (JSON: array de `{externalReference, amount, settledAt}`; CSV: colunas `external_reference,amount,settled_at`) — não um parser dedicado ao formato exato de nenhum marketplace real, porque nenhum arquivo/documentação real de liquidação (Nuvemshop, Mercado Livre, Shopee...) foi visto ao vivo neste ambiente. Registrado por padrão para `NUVEMSHOP`. Quando o formato real de um canal for confirmado, a mudança é trocar o parser registrado para aquele `marketplaceCode` — `ReceivableReconciliationService`/`SettlementParserRegistry` não mudam.

**Idempotência:** reimportar o mesmo arquivo (ou um arquivo sobreposto) não reprocessa nem reemite evento para um `ReceivableRecord` já `PAID` — contado em `alreadyReconciled`, separado de `matched`.

**Caminho manual, hoje:** `POST /financial-intelligence/settlements/import` recebe o conteúdo do arquivo como texto no corpo da requisição (não multipart) — simplificação consciente para não puxar uma dependência de upload só para este endpoint administrativo. Um futuro job/webhook por canal chamaria `ReceivableReconciliationService.reconcile(...)` no mesmo lugar.

## 4. Reprecificação reativa — como `PricingDecisionService` é acionado quando o custo muda

**Pergunta do pedido:** como o `PricingDecisionService` deve ser chamado para recalcular o Floor Price quando o custo da embalagem ou a configuração de despesas fixas mudar?

**Custo de embalagem — resposta em duas partes:**

1. **O cálculo já está sempre correto**, por construção, desde a Etapa 14: `CatalogReaderService.findBySku()` lê `Product.costPrice + Packaging.costPrice` fresco do banco em toda chamada, sem cache. Isso significa que a PRÓXIMA vez que `PricingDecisionService.decide()` for chamado para um SKU afetado, ele já usa o custo certo — nenhuma invalidação é necessária para a CORREÇÃO do número.
2. **O que faltava era proatividade** — sem nada mais, um SKU com `autoRepricingEnabled = true` só teria o preço de fato reaplicado no marketplace no próximo sinal de concorrência (`BUY_BOX_LOST`) ou clique manual em "Aplicar Preço Agora". Para isso, `PackagingsService.update()` agora emite `catalog.packaging-cost-changed` quando `costPrice` muda; um novo listener no Pricing Intelligence, `PackagingCostChangeListener`, assina esse evento, resolve quais SKUs estão vinculados àquela embalagem (nova porta `PACKAGING_LINKED_PRODUCTS_READER`, implementada por `CatalogReaderService`) e chama `PricingDecisionService.decideAndMaybeApply` para cada um — mesma função que já era usada para o sinal de Buy Box, reaproveitada aqui.

```
PackagingsService.update({ costPrice })
  costPrice mudou? ──▶ emite catalog.packaging-cost-changed { tenantId, packagingId, previousCostPrice, newCostPrice }
                              │
                              ▼
                       PackagingCostChangeListener.handleCostChanged()
                              │ PACKAGING_LINKED_PRODUCTS_READER.findSkuCodesByPackaging(tenantId, packagingId)
                              ▼
                       para cada skuCode: PricingDecisionService.decideAndMaybeApply(tenantId, skuCode)
```

Mesma disciplina de desacoplamento do `CompetitorSignalListener`: o listener importa só `catalog/domain/packaging-events.ts` (puro dado), não o `CatalogModule`/`CatalogReaderService` diretamente — quem traz `CatalogModule` para o grafo de DI do Pricing Intelligence já era necessário de qualquer forma (por causa de `PRODUCT_CATALOG_READER`/`FINANCIAL_POLICY_READER`).

**Despesas fixas (DRE) — decisão consciente, não uma lacuna esquecida:** `FixedExpense` **não entra na fórmula do Floor Price hoje**. O `PricingDecisionService`/`DefaultPricingStrategist` não mudam nada quando uma despesa fixa é criada, editada ou desativada. Motivo: transformar despesas fixas (aluguel, folha) em um "custo fixo por unidade" exige uma premissa que o sistema não tem — um volume de vendas projetado (mensal/por SKU) para ratear a despesa. Inventar esse número (ex.: "divide por X unidades estimadas") seria uma decisão de negócio arbitrária, não uma dedução da arquitetura existente. Duas extensões futuras possíveis, ambas deliberadamente NÃO implementadas ainda:

- **Rateio automático por volume projetado:** somar `FixedExpense` ativas, dividir por um volume de vendas mensal configurável por tenant, resultando num custo fixo por unidade somado ao custo variável antes do cálculo do piso — exige uma nova configuração de volume esperado.
- **Markup manual:** o tenant define diretamente um percentual adicional de margem (ex.: `fixedCostMarkupPct` em `CatalogSettings`, somado a `minProfitMargin` na fórmula já existente) para cobrir a estrutura fixa, sem depender de um número de volume — mais simples, porém desconecta o valor do markup do total de `FixedExpense` cadastrado (o tenant escolheria o percentual "no olho").

Até uma dessas ser decidida, `FixedExpense` alimenta só relatório (DRE) e a futura projeção de fluxo de caixa (seção 6) — nunca o cálculo de preço.

## 5. Eventos emitidos (para consumo futuro por Analytics/Cash Flow Projection)

- `catalog.packaging-cost-changed` (Catalog) — `{ tenantId, packagingId, previousCostPrice, newCostPrice }`.
- `financial-intelligence.receivable-paid` (Financial Intelligence) — `{ tenantId, receivableId, amount, marketplaceSource, paidAt }`.

Nenhum consumidor além dos descritos acima existe hoje; ambos seguem a mesma convenção do resto da plataforma (string + payload tipado via `EventEmitter2`) para que um futuro módulo de Analytics possa assinar sem acoplamento.

## 6. Escalando para Fluxo de Caixa Projetado — o que esta fundação já viabiliza

- **Entradas projetadas:** `ReceivableRecord` com `status = PENDING` já é, por definição, "dinheiro esperado numa data" — a projeção soma isso por período.
- **Saídas projetadas:** `FixedExpense` (`recurrenceType` + `dueDay`) já contém tudo que uma projeção precisa para "expandir" cada despesa em ocorrências futuras num calendário — a tabela guarda a REGRA, a projeção calcula as ocorrências sob demanda (não armazena uma linha por mês).
- **O que falta:** um serviço de projeção (`CashFlowProjectionService`, módulo futuro ou dentro deste) que combine as duas fontes por período e um endpoint de consulta — nenhuma mudança de schema é esperada para isso, só uma nova camada de leitura/agregação sobre o que já existe.
- **Reconciliação automática:** hoje é manual (endpoint `POST /settlements/import`); a extensão natural é um job agendado por canal que busca o relatório direto da API do marketplace e chama `ReceivableReconciliationService.reconcile(...)` — o serviço já está pronto para isso, só falta o job.

## 7. DRE em tempo real por canal (Etapa 20)

**Pedido original:** `DreReport` com `receitaBruta`/`deducoes`/`custosVariaveis`/`margemContribuicao`; `FinancialOrchestrator` lendo do `OrdersService` e agrupando por `channelId`, para os 7 marketplaces, alimentando um gráfico de barras comparativo em tempo real no Dashboard; e uma "Regra de Ouro" de integridade — custo/taxa faltante sinaliza o pedido como Incompleto sem corromper o total do período.

**Correção de premissa:** o pedido fala em `channelId`, mas esse campo não existe no schema — o identificador de canal em todo o codebase (`Order.channelCode`, `ChannelListing.channelCode`, etc.) é `channelCode`, uma string (`'NUVEMSHOP'`, `'MERCADO_LIVRE'`...). `DreChannelBreakdown` usa `channelCode`, mantendo consistência com o resto da plataforma em vez de introduzir um segundo identificador paralelo.

**"Ler do OrdersService" — implementado como porta, não import direto:** injetar a classe concreta `OrdersService` dentro de `FinancialOrchestrator` quebraria a mesma disciplina de Ports & Adapters usada em todo o resto do sistema (Catalog nunca é importado diretamente por Orders, por exemplo — só via `PRODUCT_CATALOG_READER`). Em vez disso:

```
shared/contracts/order-financials-reader.port.ts
  interface OrderFinancialsReader { listForPeriod(tenantId, dateFrom?, dateTo?): Promise<OrderFinancialLine[]> }
  token ORDER_FINANCIALS_READER

modules/orders/
  OrdersService implements OrderFinancialsReader          // reaproveita computeOrderMarginSummary (Etapa 19) em lote
  OrdersModule: { provide: ORDER_FINANCIALS_READER, useExisting: OrdersService }, exports: [ORDER_FINANCIALS_READER]

modules/financial-intelligence/
  FinancialOrchestrator injeta ORDER_FINANCIALS_READER (nunca OrdersService)
  FinancialIntelligenceModule importa OrdersModule só para consumir essa porta
```

`OrderFinancialLine`/`OrderFinancialLineItem` são DTOs PRÓPRIOS do Financial Intelligence (não os tipos internos de `Order`/`OrderItem`) — o mesmo motivo de sempre: um módulo nunca vaza seu modelo de domínio interno para outro.

**Cálculo (domínio puro, `domain/dre-report.ts`, sem I/O):**

```
receitaBruta       = soma de totalAmount dos pedidos do período, EXCLUINDO status CANCELADO (não é receita reconhecida)
deducoes           = soma de taxAmount dos itens + discountAmount dos pedidos
custosVariaveis    = CMV (custoUsado × quantidade, por item) + shippingAmount + feeAmount (comissão do canal)
margemContribuicao = receitaBruta - deducoes - custosVariaveis
```

Agrupado por `channelCode` em `DreChannelBreakdown[]`, **pré-ordenado por `margemContribuicao` decrescente** — consumível direto por um gráfico de barras sem reordenar no frontend. Só aparecem canais com pedido real no período (nenhuma lista fixa de "7 marketplaces" hardcoded no backend, para não duplicar/desalinhar com o registro de canais do frontend em `features/orders/channels.ts`); se o Dashboard quiser sempre mostrar as 7 barras — algumas zeradas —, o merge com esse registro estático é responsabilidade do frontend, não do domínio financeiro.

**Regra de Ouro — integridade sem corromper o total:**

- Item de pedido com custo desconhecido (`costKnown = false`, nem snapshot no item nem produto atual no catálogo) contribui **0 ao CMV**, nunca bloqueia ou remove o pedido do total — o pedido inteiro continua somado em `receitaBruta`/`deducoes`/demais custos conhecidos. Isso é uma aproximação conservadora-otimista: a margem reportada pode estar levemente SUPERESTIMADA quando há custo faltante, nunca subestimada por invenção de número.
- `feeAmount` é um campo obrigatório no schema (default 0, nunca nulo — Etapa 17), então não existe sinal nativo de "taxa desconhecida". Heurística adotada: `feeAmount = 0` em qualquer canal que NÃO seja Nuvemshop (`KNOWN_ZERO_FEE_CHANNELS`, hoje só `NUVEMSHOP`, o único canal com comissão zero confirmada) é tratado como suspeito e sinalizado — Nuvemshop com `feeAmount = 0` não é flagado, porque ali zero é o valor correto.
- Cada pedido problemático (custo OU taxa suspeita) aparece em `DreReport.incompleteOrders: { orderId, externalOrderId, channelCode, reasons[] }[]` — permite localizar e corrigir o pedido específico, em vez de só saber que "algo no período está incompleto". `dataQuality: 'COMPLETE' | 'INCOMPLETE'` é sinalizado tanto no relatório inteiro quanto em cada `DreChannelBreakdown` individualmente.

**Endpoint:** `GET /financial-intelligence/dre?dateFrom=&dateTo=` (ambos opcionais — sem período, cobre todos os pedidos do tenant), autenticado (`JwtAuthGuard`), devolve `DreReport` pronto para o `Dashboard` consumir diretamente (sem transformação adicional no frontend).

**Sem cache, sempre ao vivo:** mesma filosofia de "nunca cachear custo" do `ProductCatalogReader` desde a Etapa 14 — `FinancialOrchestrator` recalcula a partir do estado atual do banco a cada chamada, sem nenhuma camada de cache intermediária. Para o volume do MVP isso é aceitável; em volume maior, a próxima extensão natural é mover a agregação por período para o banco (`groupBy` no Postgres) em vez de carregar todos os pedidos do período em memória — ver aviso equivalente em `OrderRepository.findAllForPeriod`.

Testes: `dre-report.spec.ts` (cálculo de um canal completo, agrupamento/ordenação multi-canal, exclusão de CANCELADO, os 4 cenários da Regra de Ouro, período vazio sem divisão por zero), `financial-orchestrator.service.spec.ts` (delegação à porta com os argumentos corretos, com/sem período, agregação multi-canal), extensão de `orders.service.spec.ts` (implementação de `listForPeriod`, dedupe de consulta ao catálogo por SKU em todo o período, item sem custo conhecido nunca fabrica valor).

## 8. O que falta / simplificações conscientes

- Parser de repasse é genérico (seção 3), não específico de cada marketplace real.
- Importação de arquivo é por texto no corpo da requisição, não upload multipart.
- `FixedExpense` não afeta o Floor Price (seção 4) — decisão consciente, não lacuna.
- Sem workflow de aprovação/reconciliação automática ainda — tudo aqui é cadastro + reconciliação manual.
- DRE (seção 7) não inclui `FixedExpense` na margem — é margem de contribuição por pedido/canal, não lucro líquido do período (ratear despesa fixa por canal exigiria a mesma premissa de volume ainda não decidida na seção 4).
- DRE carrega todos os pedidos do período em memória para agregar (aceitável para volume de MVP, ver seção 7).
- Testes: `generic-settlement-parser.spec.ts` (parsing JSON/CSV, casos de erro), `receivable-reconciliation.service.spec.ts` (match, sem match, idempotência), `packaging.service.spec.ts` (evento emitido só quando `costPrice` muda de fato), `packaging-cost-change.listener.spec.ts` (fan-out para SKUs vinculados, falha em um não trava os demais), testes de DRE listados na seção 7.
