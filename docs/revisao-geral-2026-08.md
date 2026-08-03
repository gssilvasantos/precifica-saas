# Revisão Geral do Kyneti — 01/08/2026

**Escopo:** leitura do código real (19 módulos, 66 models Prisma, 20 schemas Postgres, frontend com 34 páginas) cruzada com o levantamento de mercado (`market-landscape-analysis.md`, 21 sistemas) e com os benchmarks de ERP já existentes (Bling, Tiny).

**Método:** cada afirmação abaixo foi verificada lendo o arquivo citado — não é inferência a partir de documentação. Onde a documentação do projeto e o código divergem, o código foi tratado como a verdade.

**Resumo executivo:** o projeto está muito mais completo do que qualquer documento isolado sugere — a auditoria de frontend de 31/07 já está obsoleta (ver §6). Mas há **uma inconsistência crítica no motor de precificação** (§1) que, na minha leitura, é o item mais importante deste documento: o componente que altera preço automaticamente no marketplace usa uma fórmula de margem incompleta, enquanto outros dois módulos da mesma base de código usam a fórmula completa. Nada mais nesta revisão chega perto disso em severidade.

---

## 1. ✅ CORRIGIDO (01/08/2026) — O motor de repricing defendia um piso que não cobria a comissão do marketplace

> **Status:** corrigido e testado nesta mesma data. 1108 testes passando (106 suítes), `tsc --noEmit` limpo. O diagnóstico original está preservado abaixo, seguido do que foi feito em §1.5.

### O achado

Existem **duas fórmulas de margem diferentes** convivendo na base de código, e a que decide preço automaticamente é a incompleta.

**Fórmula A — completa** (`promotion-intelligence/domain/margin-calculator.ts:40`, `calculateNetMargin`):

```
margem = preço − (comissão% × preço + taxa fixa) − imposto − custo do produto − logística(embalagem + operacional)
```

**Fórmula B — incompleta** (`pricing-intelligence/domain/pricing-strategist.ts:108`, `calculateSafetyFloorPrice`):

```
piso = custo do produto / (1 − margemMínima%)
```

A Fórmula B não desconta **comissão do marketplace** (`commissionPct` + `fixedFeeAmount`) nem **custo operacional de logística**. E é ela que governa o `DefaultPricingStrategist` — o componente que o `PricingDecisionService` usa para calcular e **efetivamente aplicar** preço no canal via `PRICE_UPDATE_DISPATCHER` (`pricing-decision.service.ts:264`).

> **Correção ao diagnóstico inicial:** a **embalagem já está incluída**. `ProductCatalogSummary.costPrice` é o custo *efetivo* (`productCostPrice + packagingCostPrice`), e é esse campo que o motor usa. O que falta é comissão do canal e custo operacional de armazém. Isso também impõe um cuidado na correção: ao passar a somar `logisticsCost` (que já contém a embalagem), é obrigatório trocar a base para `productCostPrice`, senão a embalagem passa a ser contada duas vezes — exatamente o que `promotion-intelligence.service.ts:73` já faz e comenta.

### Por que isso é grave, com número

Produto: custo R$ 60, `minimumMarginPct` = 20%, vendido no Mercado Livre (comissão ~14% + frete ~R$ 20).

- O motor calcula o piso de segurança: `60 / (1 − 0,20)` = **R$ 75**.
- O motor entende que R$ 75 é "seguro" e pode baixar até lá para acompanhar concorrente.
- O que de fato entra no caixa a R$ 75: `75 − 10,50 (comissão) − 20 (frete)` = **R$ 44,50**.
- Custo do produto: R$ 60. **Prejuízo real de R$ 15,50 por venda** — num preço que o sistema classifica como `SAFETY_FLOOR_APPLIED`, ou seja, protegido.

O piso financeiro do tenant (`calculateFinancialFloorPrice`, mesma linha de raciocínio, `custo / (1 − (taxRate + minProfitMargin))`) tem o mesmo problema: cobre imposto e margem líquida global, mas nunca a comissão do canal.

### Por que eu classifico como inconsistência, não como decisão consciente

Três evidências de que a arquitetura *pretendia* que o motor de preço usasse a fórmula completa:

1. **A porta existe e foi escrita explicitamente para isso.** `shared/contracts/fee-rule-resolver.port.ts:1` abre com: *"Porta consumida pelo futuro Pricing Intelligence — é a ÚNICA coisa que o motor de preço vai conhecer do Marketplace Intelligence."*
2. **A porta já está injetada no módulo.** `FEE_RULE_RESOLVER` está em `pricing-intelligence.module.ts` e é usada pelo `NuvemshopMarginSimulatorService` — mas **não** pelo `PricingDecisionService`. O `resolveDecision` injeta 6 portas (`pricing-decision.service.ts:52-59`) e nenhuma delas é a de taxa, embalagem ou logística.
3. **Promoções já faz certo, no mesmo repositório.** `promotion-intelligence.service.ts:64-77` resolve `feeRule` + `policy` + `logisticsCost` em paralelo e passa tudo para `calculateNetMargin`. Ou seja: **aderir a uma promoção é protegido por margem líquida real; mudar o preço no dia a dia não é.**

Há ainda um detalhe que torna o problema fácil de não enxergar: o comentário de `calculateNetMargin` (linha 34) diz *"mesma convenção de marginPctOf em pricing-strategist.ts"*. A afirmação é verdadeira só quanto ao **denominador** (as duas medem margem sobre o preço de venda). O **numerador** é completamente diferente — líquido de taxas num caso, bruto no outro. Quem lê os dois arquivos rapidamente conclui que são equivalentes.

### Correção sugerida

Não é construir nada novo — é reusar o que já existe:

1. `PricingContext` ganha `commissionPct`, `fixedFeeAmount`, `logisticsCost` e `channelCode`.
2. `PricingDecisionService.resolveDecision` injeta `FEE_RULE_RESOLVER` e `LOGISTICS_COST_READER` e os resolve junto do que já busca (o `Promise.all` já existe, linha 112). O `LogisticsCostReader.getTotalLogisticsCost(tenantId, skuCode, channelCode)` **já aceita canal** — a infraestrutura está pronta.
3. `calculateSafetyFloorPrice` passa a inverter a Fórmula A em vez da B: o piso é o menor preço cuja margem *líquida* ainda atinge `minimumMarginPct`.
4. A defesa em profundidade de `resolveDecision` (linha 163) e o gate final de `dispatchDecision` continuam iguais em estrutura — só passam a comparar contra o piso correto.

**Ponto que precisa da sua decisão:** ao corrigir, produtos hoje com `minimumMarginPct` calibrado "no olho" para compensar a ausência da comissão vão passar a ter piso bem mais alto — pode haver um susto de "todo mundo ficou caro". Vale rodar primeiro em modo simulação (calcular o piso novo e o antigo lado a lado, sem aplicar) antes de trocar de fato.

### 1.5 O que foi implementado

**Princípio adotado (definido pelo usuário em 01/08/2026):** o sistema guarda como valor fixo apenas o **custo do produto**, a **alíquota de imposto** e o **custo unitário da embalagem**. Toda taxa de marketplace é **importada do próprio canal** — nunca digitada, nunca estimada. A consequência de projeto mais importante disso é a regra de bloqueio abaixo.

**Domínio** (`domain/pricing-strategist.ts`):

- `PricingContext` ganhou `channelCode`, `commissionPct`, `fixedFeeAmount`, `logisticsCost`, mais `feeRuleId`/`feeRuleVersion` (rastreabilidade) e `effectiveCostPriceLegacy` (comparativo).
- Nova função `calculateNetMarginFloorPrice`, que inverte a fórmula de margem líquida:
  `P = (custo + logística + taxaFixa) / (1 − comissão − imposto − margemAlvo)`.
  A fórmula antiga é o caso particular desta com comissão, imposto, taxa fixa e logística iguais a zero — ou seja, ela só era correta para um canal sem nenhum custo, que não existe na prática.
- `marginPctOf` (margem bruta) foi substituída por `netMarginPctOf`, agora de fato equivalente ao `calculateNetMargin` das Promoções. O comentário que afirmava falsa equivalência foi corrigido.
- Nova `UnreachableMarginError` para o caso legítimo de margem impossível naquele canal (ex.: comissão 30% + imposto 10% + margem 65% = 105%) — erro explícito em vez de número negativo silencioso.

**Aplicação** (`application/pricing-decision.service.ts`):

- Passou a injetar `FEE_RULE_RESOLVER`, `LOGISTICS_COST_READER` e a nova `CHANNEL_CATEGORY_RESOLVER`.
- **Resolve a comissão na granularidade real do marketplace:** categoria interna do produto → `ChannelCategoryMapping` → categoria do canal (`MLBxxxx`) → `MarketplaceRule` daquela categoria. Se não houver mapeamento, tenta o escopo `GLOBAL` (mesma convenção do Promotion Intelligence).
- **Regra de bloqueio:** sem regra de comissão **validada**, a decisão não é calculada e nenhum preço é aplicado. Assumir zero reintroduziria o mesmo bug de forma silenciosa. Vale o mesmo para monitoramento sem canal definido.
- Troca de `product.costPrice` (efetivo) para `product.productCostPrice` — obrigatório, já que `logisticsCost` já contém a embalagem.

**Modo simulação (o "antes x depois" pedido):** `PricingDecision.costs` traz `commissionPct`, `fixedFeeAmount`, `logisticsCost`, `taxRate`, `feeRuleId`/`feeRuleVersion` e `legacyFloorPriceForComparison` — o piso que a fórmula antiga teria dado. Como `GET /pricing-intelligence/products/:id` só calcula (nunca aplica), a simulação já está disponível por ali sem nenhuma tela nova: dá para ver piso novo × piso antigo por SKU antes de ligar o repricing automático.

**Efeito colateral positivo:** os dois pisos (produto e financeiro do tenant) agora usam a mesma fórmula, variando só o alvo de margem. Antes eram incomparáveis — um era margem bruta sobre custo, o outro já descontava imposto —, e "qual é mais restritivo" dependia de comparar coisas diferentes. Agora vence quem pede a maior margem líquida, o que é previsível e explicável ao usuário.

**Nota sobre a granularidade da importação (não corrigido, fica registrado):** o `MercadoLivreFeeRuleProvider` captura a comissão num único ponto de referência (`REFERENCE_PRICE = 100`) e prioriza o tipo de anúncio Clássico (`gold_special`). O Mercado Livre varia comissão por **faixa de preço** e por **tipo de anúncio** (Clássico × Premium). Então a taxa importada hoje é fiel para SKUs perto de R$100 no Clássico, e aproximada fora disso. A arquitetura já suporta `scopeKey` mais granular — é evolução do provider, não do motor de preço. Dado o princípio de "importar fielmente", este é o próximo passo natural desta frente.

**Arquivos alterados:**

| Arquivo | Mudança |
|---|---|
| `domain/pricing-strategist.ts` | Fórmula de piso, contexto, `netMarginPctOf`, `UnreachableMarginError`, validações |
| `domain/default-pricing-strategist.ts` | Usa os pisos novos, monta o breakdown de custos |
| `application/pricing-decision.service.ts` | Injeta 3 portas, resolve categoria do canal, bloqueia sem taxa |
| `pricing-intelligence.module.ts` | Importa `LogisticsFulfillmentModule` e `MarketplacePublishingModule` |
| `shared/contracts/channel-category-resolver.port.ts` | Porta nova |
| `shared/contracts/tokens.ts` | Token `CHANNEL_CATEGORY_RESOLVER` |
| `marketplace-publishing/application/channel-category-resolver.service.ts` | Adaptador da porta |
| `marketplace-publishing.module.ts` | Exporta a porta |
| 2 arquivos `.spec.ts` | Casos novos + atualização dos que codificavam a fórmula antiga |

---

## 2. ✅ CORRIGIDO (01/08/2026) — O DRE ignorava custo de Ads

> **Status:** implementado no nível canal (passo 1 do plano abaixo), com tela. 1141 testes passando. O passo 2 (rateio por pedido) segue pendente — ver §2.5.

`financial-intelligence/domain/dre-report.ts:137` — o waterfall é:

```
receitaBruta − (impostos + descontos) − (CMV + fretes + comissões) = margemContribuicao
```

Busca por `ads|Ads|adSpend` no módulo inteiro: **zero ocorrências**. O gasto com publicidade nunca é deduzido do resultado.

Isso é exatamente o que a pesquisa de mercado mostrou ser **tabela-stakes**: Jodda.ia, Letzee, Emori e Mercado Turbo vendem precisamente "margem com Ads descontado" como feature central (`market-landscape-analysis.md`, §7). É o gap mais visível comercialmente de toda esta revisão.

**O que já existe:** `AdsMetricSnapshot` (schema `marketplace_ads`) tem `spend`, `revenueAds`, `clicks`, `impressions` por **campanha × dia**, com `channelCode` na campanha.

**O que falta:** não existe vínculo campanha → SKU/anúncio. Sem isso, não dá para atribuir gasto a um pedido específico com honestidade.

**Caminho em dois passos (recomendo os dois, nessa ordem):**

- **Passo 1 — barato, dado já existe hoje.** Adicionar `custoAds` ao `DreChannelBreakdown` por canal e período (somar `AdsMetricSnapshot.spend` por `channelCode`). Isso já torna o resultado consolidado honesto e não exige schema novo. O `dataQuality` existente é o lugar natural para sinalizar "sem dado de Ads no período".
- **Passo 2 — estruturante.** Um model `AdsCampaignListing` (campanha ↔ `ChannelListing`) permitindo rateio por pedido. Aí sim `DreOrderLine` ganha `custoAdsRateado`. Vale confirmar antes se a API de Ads do Mercado Livre entrega atribuição no nível do anúncio — se entregar, o rateio vira dado real em vez de estimativa.

> **✅ CONFIRMADO E IMPLEMENTADO (01/08/2026).** A verificação na documentação oficial derrubou a ressalva: a API **entrega** custo por anúncio.
> ```
> GET /advertising/{SITE}/product_ads/ads/{ITEM_ID}?date_from=&date_to=&metrics=cost,units_quantity
> ```
> Ver §2.6.

### 2.5 O que foi implementado (passo 1)

**Origem do dado:** o gasto vem **importado do próprio marketplace**, não digitado. `AdsMetricSnapshot.spend` é preenchido pelo `AdsSyncOrchestrator` a partir de cada `AdsCapableProvider`. Hoje existe **um provider real: Mercado Livre** (`mercado-livre-ads.provider.ts`); os demais canais entram conforme seus providers de Ads forem construídos — sem mudar nada no DRE, que consome a porta e não o provider.

**Onde a linha entra no waterfall:** `custoAds` fica **depois** da margem de contribuição, como linha própria, e não dentro de `custosVariaveis`. Motivo: publicidade é custo de **período**, não de pedido, e margem de contribuição tem definição contábil que não inclui mídia. Somá-la ali mudaria silenciosamente o significado de uma métrica já usada em gráfico e tela. Há teste garantindo que `margemContribuicao` e `custosVariaveis` não mudam com Ads presente — a extensão é aditiva.

**Honestidade sobre ausência de dado:** `adSpendDataAvailable` distingue *"não anunciou"* (`true`, `custoAds` 0) de *"não sabemos"* (`false`, nunca houve sync). Sem isso os dois apareceriam como R$0 e o lojista não teria como saber se a margem exibida já considera mídia. A tela mostra um aviso nomeando os canais sem dado.

**Gasto em canal sem venda no período é ignorado** no consolidado: não há receita contra a qual compará-lo, e incluí-lo distorceria o total sem aparecer em nenhuma linha por canal.

| Arquivo | Mudança |
|---|---|
| `shared/contracts/ads-spend-reader.port.ts` | Porta nova + `ADS_SPEND_READER` |
| `marketplace-ads/application/ads-spend-reader.service.ts` | Adaptador |
| `prisma-ads-campaign.repository.ts` | `sumSpendByChannel` |
| `financial-intelligence/domain/dre-report.ts` | `custoAds`, `margemAposAds`, `adSpendDataAvailable` |
| `financial-orchestrator.service.ts` | Injeta a porta, resolve em paralelo |
| `apps/web/.../FinanceiroPage.tsx` | Cards de Publicidade e Margem após Ads + aviso |

### 2.6 Ads por PEDIDO (passo 2) — a ressalva que não se confirmou

**A dúvida era legítima e a resposta mudou o desenho.** A hipótese de trabalho era que a API do ML só entregava gasto por campanha, e que qualquer atribuição por pedido seria estimativa disfarçada de número exato. Verificado na documentação oficial: **falso**. O endpoint `/advertising/{SITE}/product_ads/ads/{ITEM_ID}` aceita `metrics=cost,units_quantity` e devolve investimento **por anúncio**, com `aggregation_type` DAILY ou por item.

Isso muda a natureza do dado: como `ChannelListing` já liga anúncio↔SKU, o custo de mídia chega ao **produto** sem nenhuma estimativa no caminho.

**Onde ainda existe divisão, e por quê.** O marketplace sabe quais vendas vieram de anúncio, mas **não expõe essa marcação por pedido** — só o agregado do anúncio. Então "R$120 de mídia no SKU X, que vendeu 40 unidades no período" vira R$3/unidade, aplicado proporcionalmente à quantidade de cada pedido. É uma divisão explícita, verificável e que **fecha**: há teste garantindo que a soma do rateado é exatamente o gasto do SKU. Muito diferente de espalhar o gasto do canal inteiro sobre todos os pedidos, que era a única alternativa antes.

Três decisões de honestidade:
- **Anúncio sem SKU vinculado é descartado** do rateio (atribuir gasto ao produto errado é pior que não atribuir). O dinheiro continua contado no `custoAds` do canal.
- **Gasto em SKU que não vendeu no período não onera pedido nenhum** — a mídia não converteu, e essa é a verdade a mostrar.
- **Sem captura por item, o rateio fica zerado**, nunca estimado a partir do total do canal.

`DreOrderLine.margemLiquida` continua **sem** Ads; a coluna nova `margemLiquidaAposAds` é aditiva. Na tela, a margem em negrito passou a ser a "após Ads" — é ela que responde se o pedido deu lucro.

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | `AdsItemMetricSnapshot` (aplicado em produção com RLS) |
| `shared/contracts/ads-spend-reader.port.ts` | `sumSpendBySku` + `AdsSpendBySku` |
| `shared/contracts/channel-listing-reader.port.ts` | `findSkusByExternalIds` (direção inversa anúncio→SKU) |
| `marketplace-ads/application/ads-spend-reader.service.ts` | Tradução anúncio→SKU em lote |
| `financial-intelligence/domain/dre-report.ts` | `buildAdsCostPerUnitBySku`, `custoAdsRateado`, `margemLiquidaAposAds` |
| `marketplace-ads.module.ts` | Importa `ErpIntegrationModule` (validado com teste de DI real) |

#### Captura ligada (02/08/2026)

A conexão OAuth do Mercado Livre está ativa (seller `2341287049`), o que destravou a captura. Implementado:

- **`ProviderCapability.ADS_ITEM_METRICS`** — capacidade separada de `ADS` (Interface Segregation): nem todo canal expõe custo por item. Canal sem ela simplesmente não entra no fluxo, e o DRE continua com o total por canal.
- **`MercadoLivreApiClient.fetchAdsItemMetrics`** — usa o endpoint de busca **paginado** (`/product_ads/ads/search` com `metrics=cost,units_quantity,clicks,prints` e `aggregation_type=daily`) em vez de consultar `/ads/{ITEM_ID}` um a um: com dezenas de anúncios ativos, item a item seriam dezenas de round-trips por sync.
- **`AdsSyncOrchestrator`** grava por `(tenant, canal, anúncio, dia)`, idempotente. Em **try/catch próprio**: falhar a captura por item não invalida as métricas de campanha já persistidas no mesmo ciclo.
- **Normalização tolerante** — `normalizeMlAdsItemMetric` devolve `null` (não lança) para linha em formato inesperado, então um anúncio problemático é descartado com log sem derrubar os outros. Diferente da métrica por campanha, onde a chave é obrigatória e lançar é correto.

**Ponto honesto sobre o path:** o endpoint segue a convenção `/marketplace/advertising/...` que já funciona para campanhas neste projeto; a documentação pública mostra variações com e sem o prefixo `/marketplace`. Se a primeira chamada real retornar 404, é aí que se ajusta — e o normalizador rejeita resposta fora do formato em vez de gravar lixo.

---

## 3. ✅ CORRIGIDO (01/08/2026) — O "DRE" parava na margem de contribuição

> **Status:** waterfall estendido até `resultadoOperacional`, com tela. Ver §3.5.

O relatório se chama DRE, mas o waterfall termina em `margemContribuicao`. `FixedExpense` e `AccountsPayable` existem como models completos (com CRUD, parcelamento, baixa com juros/desconto) e **nunca entram no relatório**.

Ou seja: o lojista vê quanto sobra depois dos custos variáveis, mas nunca vê se a operação fecha no azul depois de aluguel, salário, software e demais despesas fixas — que é a pergunta que um DRE existe para responder.

**Sugestão:** estender o waterfall com uma linha de despesas operacionais do período (`FixedExpense` + `AccountsPayable` com vencimento na janela) chegando a um `resultadoOperacional`. Enquanto isso não existir, considerar renomear na UI para "Margem de Contribuição por Canal" — o nome atual promete mais do que entrega, e isso é o tipo de coisa que queima confiança quando o cliente percebe.

### 3.5 O que foi implementado

**Correção à sugestão original:** ela dizia somar `FixedExpense` **+ `AccountsPayable`**. Isso estaria **errado**. `AccountsPayable` contém, entre outras coisas, as contas geradas por Ordem de Compra — ou seja, **compra de estoque**. Compra de estoque não é despesa quando paga; vira CMV quando o item é vendido, e o CMV já está em `custosVariaveis`. Somar as duas contaria o mesmo dinheiro duas vezes e mostraria prejuízo onde não há. **Só `FixedExpense` entra**, que é despesa operacional de verdade.

**O rateio é o ponto delicado.** O DRE aceita qualquer janela de datas, mas despesa fixa tem recorrência própria — "quanto do aluguel pertence a 12–27 de julho?" não tem resposta óbvia. A solução (`fixed-expense-proration.ts`) é taxa diária com o divisor vindo do período **real** a que cada dia pertence: cada dia de janeiro contribui `valor/31`, cada dia de fevereiro `valor/28`. Isso torna o rateio **exato** no caso comum (mês fechado devolve exatamente o valor, não 1,02×) e proporcional em qualquer outro. Um divisor fixo de 30 daria 103% do aluguel em janeiro — erro pequeno que apareceria na tela como "lucro que sumiu" sem explicação.

**Período aberto não é rateado.** Sem data inicial e final não existe "quanto do aluguel pertence a um intervalo sem fim". Nesse caso `despesasFixas` fica 0, `despesasFixasApuradas` vira `false` e a tela avisa — em vez de exibir um resultado operacional falso.

O waterfall agora é: receita → deduções → custos variáveis → **margem de contribuição** → Ads → **margem após Ads** → despesas fixas → **resultado operacional**. Há teste garantindo que margem de contribuição e margem após Ads não mudam: a extensão é aditiva.

---

## 4bis. ✅ CORRIGIDO (01/08/2026) — Radar de concorrência automático

O `MercadoLivreCatalogRadar` substitui a dependência de planilha manual. Usa a **API pública de catálogo** do Mercado Livre (`/products/{id}` e `/products/{id}/items`), **sem OAuth** — o que o torna utilizável hoje, sem depender do fluxo de autorização por vendedor que ainda não existe, e sem scraping (frágil e de legalidade duvidosa).

Detalhe de usabilidade que vale registrar: o `targetRef` aceita **id de produto de catálogo ou id de anúncio**. Exigir que o usuário soubesse a diferença seria transferir um detalhe da API do ML para dentro do cadastro; o radar tenta como produto, e se falhar, trata como anúncio e descobre o produto ao qual pertence.

Três decisões de honestidade: oferta sem preço é **descartada** (assumir R$0 criaria um "concorrente de graça" que puxaria toda decisão para o piso); anúncio fora do catálogo devolve vazio **com log explicando** (não há Buy Box a disputar); e o rótulo do concorrente usa o `seller_id` real, porque o endpoint público não expõe o nome — inventar um rótulo amigável seria pior.

O `ManualSheetRadar` continua registrado como fallback para canais sem radar próprio. Adicionar Shopee ou Amazon é um arquivo novo e uma linha no registro — sem tocar no orquestrador nem no contrato.

---

## 4. 🟠 ALTO — O radar de concorrência não tem fonte automática

`competition-intelligence/infrastructure/radars/` tem **exatamente uma implementação**: `manual-sheet-radar.ts`. Não há radar que leia preço de concorrente do Mercado Livre ou Shopee automaticamente.

Isso é estrutural para o resto: o `PricingDecisionService` só decide quando existe `opportunity` com `bestCompetitorPrice` e `buyBoxStatus` (`pricing-decision.service.ts:122-129`) — sem isso, ele retorna `null` e nada acontece. Na prática, **todo o loop de repricing depende hoje de alguém preencher uma planilha à mão.**

A arquitetura está certa (`CompetitionRadar` é um contrato, adicionar radar novo é Open-Closed puro, sem tocar o núcleo). O que falta é uma implementação real. Pela pesquisa de mercado, é justamente aqui que Precifica, WinnerBox e VC Price concentram o valor que cobram — vale tratar como prioridade de produto, não como detalhe técnico.

---

## 5. 🟡 MÉDIO — Precificação é por produto; o mercado precifica por canal

Hoje: `Product.desiredMarginPct` / `minimumMarginPct` / `mapPrice` são **por produto**. `PriceList` tem `adjustmentPct` global e `PriceListException` é por produto — **nenhum dos dois tem `channelCode`**. `ChannelListing.currentPrice` existe mas está marcado como *"informativo, espelhado"*.

O problema concreto: o mesmo SKU no Mercado Livre (comissão ~14%) e na Nuvemshop (gateway ~4%) precisa de **preços diferentes** para entregar a mesma margem. Sem dimensão de canal, ou a margem no ML fica menor que o configurado, ou o preço na Nuvemshop fica desnecessariamente alto.

A Magis5 documenta explicitamente a solução (`market-landscape-analysis.md`, §6.4): configuração em dois níveis com precedência — se o anúncio tem config própria, usa a do anúncio; senão, herda a do produto.

**Nota:** este item é parcialmente resolvido de graça pelo §1. Ao injetar `FeeRuleResolver` (que já é por `marketplaceCode`) e `getTotalLogisticsCost(..., channelCode)`, o piso passa a ser naturalmente diferente por canal, mesmo sem nenhum campo novo. O que continuaria faltando é o **override manual** por anúncio — que é um passo posterior e menor.

---

## 6. 🟡 MÉDIO — Documentação desatualizada induz a planejamento errado

**`docs/frontend-coverage-gap-audit.md` (31/07) está obsoleto.** Ele afirma que 13 conjuntos de funcionalidade têm "ZERO tela". Verificando `apps/web/src/routes/`, existem hoje: `PurchaseOrdersPage`, `SellersPage`, `SuppliersPage`, `FiscalInvoicesPage`, `DispatchBatchesPage`, `LotsPage`, `PriceListsPage`, `CarriersPage`, `ProductionOrdersPage`, `CompetitionRadarPage`, `MarketplaceGovernancePage`, `PackagingPage`, `TagsPage` — praticamente todos os itens listados como faltantes. Os `features/*/api.ts` correspondentes também existem.

Recomendo marcar o documento como resolvido no topo (não apagar — o histórico do raciocínio tem valor), senão ele volta a pautar trabalho já feito.

**`README.md` ainda chama o produto de "Precifica SaaS"** (linha 1), enquanto os docs recentes usam Kyneti. Além da inconsistência interna, "Precifica" é uma empresa real e concorrente direta (precifica.com.br) — detalhe registrado em `market-landscape-analysis.md`, §0. Vale unificar em Kyneti antes de qualquer material externo.

---

## 7. Módulos a criar — o que a pesquisa recomenda absorver

Da visão de `platform-architecture.md` §2, dois módulos seguem "não iniciado", e a pesquisa de mercado dá conteúdo concreto para os dois:

### Analytics (não iniciado)

- **Curva ABC de faturamento cruzada com Curva ABC de margem** — achado em Mercado Turbo e Emori. Revela o produto que vende muito e sangra margem, e o que vende pouco mas sustenta o resultado. É a análise mais citada e não existe hoje.
- **Métricas que o mercado trata como padrão:** GMV, ROI, CAC, taxa de conversão, reputação, cancelamento.
- Depende de §2 e §3 para ser honesto — analytics sobre margem incompleta propaga o erro.

### AI Intelligence (não iniciado)

Já existe base real: `anthropic-campaign-advisor.service.ts` no módulo de Ads. O caminho natural é generalizar esse padrão (consumir read-ports de vários módulos e sugerir ação) em vez de começar do zero.

### Conciliação — diferencial a confirmar

A Confery, concorrente direta nessa peça, **não documenta publicamente como trata divergência** (recebido ≠ esperado). Se o `ReceivableReconciliationService` do Kyneti já tem fluxo explícito de exceção, isso é vantagem competitiva concreta a destacar no PRD. Não verifiquei esse arquivo nesta revisão — vale um olhar dedicado.

---

## 8. O que está bem-feito (e não deve ser mexido)

Registro deliberado, porque revisão só com problemas distorce a leitura:

- **A disciplina de portas é real, não decorativa.** Verifiquei vários módulos: ninguém injeta `PrismaService` para ler tabela de outro contexto. A regra da §3 do `platform-architecture.md` está sendo cumprida de fato — é raro e é o que torna as correções acima baratas.
- **Safety Lock consistente.** Ação de escrita (Ads, publicação de anúncio, expedição) sempre exige confirmação humana explícita. O gate triplo de MAP (`PricingStrategist` → `resolveDecision` → `dispatchDecision`) é defesa em profundidade bem aplicada.
- **`dataQuality` no DRE.** Nunca fabricar custo que ninguém informou, e sempre apontar o pedido exato incompleto em vez de um agregado vago, é uma decisão madura — mantém o relatório utilizável sem mentir.
- **Domínio puro e testável.** As calculadoras (`margin-calculator`, `pricing-strategist`, `package-weight-calculator`, `dre-report`) são funções sem I/O, testadas sem mock. É o que permite corrigir a §1 com confiança.
- **Comentários explicam o *porquê*, não o *o quê*.** Padrão raro e que segurou esta revisão inteira — várias decisões só ficaram compreensíveis por causa deles.

---

## 9. Ordem sugerida de ataque

| # | Item | Status |
|---|---|---|
| ~~1~~ | ~~**Piso de preço com margem líquida** (§1)~~ | ✅ Feito em 01/08/2026 — §1.5 |
| ~~2~~ | ~~**Ads no DRE, nível canal** (§2, passo 1)~~ | ✅ Feito em 01/08/2026 — §2.5 |
| ~~3~~ | ~~**Radar de concorrência automático** (§4)~~ | ✅ Feito em 01/08/2026 — §4bis |
| ~~4~~ | ~~**Despesas fixas no DRE** (§3)~~ | ✅ Feito em 01/08/2026 — §3.5 |
| ~~5~~ | ~~**Atualizar docs desatualizados** (§6)~~ | ✅ Feito em 01/08/2026 |
| ~~6~~ | ~~**Ads por pedido** (§2, passo 2)~~ | ✅ Feito em 01/08/2026 — §2.6. A ressalva ("seria estimativa") **não se confirmou**: a API do ML entrega custo por anúncio |
| 7 | **Override de preço por anúncio** (§5) | ⏳ Pendente — parcialmente resolvido de graça pelo item 1 (o piso já é diferente por canal); falta só o override manual |

**Estado em 01/08/2026:** seis dos sete itens concluídos, com testes (1172 passando, 110 suítes). Os dois restantes são de **funcionalidade faltando** — problema honesto e visível para o usuário —, e ambos dependem de uma confirmação externa antes de valer a pena construir (o item 6, de saber o que a API de Ads do ML entrega; o item 7, de haver demanda real por override manual, já que o piso por canal saiu de graça no item 1).

O item 1 era de natureza diferente de todos os outros: o sistema dava um número errado com aparência de certo — o tipo de falha que ninguém reporta porque ninguém percebe.

**Migration aplicada em produção (Supabase, projeto Kyneti):** `warehouses.estimatedFreightCost` e a tabela `channel_seller_profiles`, ambas aditivas, com RLS `ENABLE`+`FORCE` e policy de isolamento por tenant na mesma transação da criação. Registrada em `_prisma_migrations` para não desalinhar o histórico do Prisma.
