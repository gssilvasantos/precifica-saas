# Modelo de Taxa Multi-Marketplace — arquitetura

**Data:** 01/08/2026
**Motivação:** o princípio de produto definido pelo usuário — *o sistema só guarda como valor fixo o custo do produto, a alíquota de imposto e o custo unitário da embalagem; toda taxa de marketplace é importada do próprio canal* — só se sustenta se o modelo de dados conseguir representar **como cada canal realmente cobra**. Hoje ele não consegue.
**Escopo:** Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu, Shein e Nuvemshop.
**Relacionado:** `revisao-geral-2026-08.md` §1 (correção do piso de preço), `marketplace-intelligence-architecture.md` (modelo `MarketplaceRule`).

---

## 1. O problema com o modelo atual

`FeeRulePayload` guarda hoje **dois escalares**:

```ts
{ commissionPct: number; fixedFeeAmount: number; referencePrice?: number; listingTypeId?: string }
```

E o `MercadoLivreFeeRuleProvider` captura esses escalares num **único ponto de referência** (`REFERENCE_PRICE = 100`), do tipo de anúncio Clássico. Isso assume que a taxa é constante — e ela não é em nenhum dos sete canais.

Dois problemas independentes:

**1.1 — A taxa é uma função do preço, não um número.** A Shopee cobra 20% em item de até R$79,99 e 14% acima; a taxa fixa varia de R$4 a R$26 conforme a faixa. Capturar "a comissão" a R$100 e aplicá-la a um produto de R$40 erra por 6 pontos percentuais e R$12 de taxa fixa.

**1.2 — Bug de unidade (latente, já em produção).** O validador aceita `commissionPct` entre **0 e 100** (percentual). O provider do ML grava `sale_fee_details.percentage_fee`, que a API devolve como percentual (ex.: `11.5`). Mas os dois consumidores tratam o valor como **fração**:

- `promotion-intelligence/domain/margin-calculator.ts` — `commissionPct: number; // fração (0-1)`
- `pricing-intelligence/domain/pricing-strategist.ts` (após a correção de §1) — idem

Com uma regra real importada (`11.5`), o motor de promoções calcularia 1150% de comissão e reprovaria toda campanha como VERMELHO; o motor de preço, após a correção de §1, lançaria `InvalidPricingContextError` e bloquearia a decisão. Nenhum dos dois produz preço errado — falham fechado —, mas ambos param de funcionar assim que a primeira regra real for importada. **Isso não apareceu ainda porque nenhuma regra do ML foi validada em produção;** o `GLOBAL` que as Promoções usam hoje é cadastrado à mão, provavelmente já em fração.

---

## 2. Como cada canal realmente cobra

Levantamento de 01/08/2026 (fontes na §7). A coluna que mais importa é **"dimensões de variação"** — é ela que define o formato do payload.

### 2.0 Anatomia completa do custo — não é só comissão

Levantamento aprofundado. Cada canal cobra em **camadas diferentes**, e várias não são comissão:

| Canal | Comissão | Taxa fixa/item | Frete | Outras camadas |
|---|---|---|---|---|
| **Mercado Livre** | 10–14% Clássico · 15–19% Premium, por categoria | Desde mar/2026: custo por unidade **variável por peso e dimensão** (itens R$19–79) | **R$19–78,99:** ML cobre 100% (produto novo, entrega padrão). **≥R$79:** frete grátis **obrigatório**, pago pelo vendedor, com desconto de até **70% conforme reputação** | Reputação do vendedor muda o subsídio. Peso real × peso cubado — o maior vence |
| **Shopee** | ≤R$79,99: 20% · R$80–99,99: 14% · R$100–199,99: 14% · ≥R$200: 14% | R$4 · R$16 · R$20 · R$26 (mesma faixa da comissão) | **Frete grátis obrigatório e automático desde mar/2026.** Shopee subsidia 30–60% conforme **região**; o vendedor absorve 3–12 p.p. da venda | Teto de R$100 removido em 2026. CPF com >450 pedidos/90d: +R$3/item. O antigo +6% do programa de frete foi **embutido** na tabela nova |
| **Amazon** | 8–15% (até 20% em algumas categorias) | Plano Individual: **R$2/item**. Plano Profissional: **R$19/mês** fixo | FBM (negociado pelo vendedor) · FBA (tarifa por unidade, por peso/preço/dimensão) · DBA (por unidade, mais competitivo abaixo de R$79) | ⚠️ **A comissão incide sobre o total pago pelo comprador — produto + frete.** Regra de cálculo diferente de todos os outros |
| **TikTok Shop** | 6% na maioria; 5% em algumas categorias | — | Por conta do vendedor / programas próprios | Processamento de pagamento **1,02%–3,78%** |
| **Magalu** | 12–20% por categoria | — | Magalu Entregas: peso × dimensão × **distância**, repassado ao vendedor | **9,9% promocional para novos sellers** (janela limitada) — dimensão temporal |
| **Shein** | **16% flat**, só sobre pedido entregue | — | Co-participado, por peso e dimensão | 30 dias sem comissão para novo seller CNPJ. Comissão devolvida em cancelamento |
| **Nuvemshop** | Não há (ver §5) | Cartão: +R$0,35/transação · Boleto: R$2,39 | Por conta do lojista (Nuvem Envio ou próprio) | Tarifa de plano 0%/2%/1%/0,7% + gateway (Pix 0,99%) |

**Cinco dimensões que esse aprofundamento revelou e que o modelo precisa acomodar:**

1. **Base de cálculo da comissão.** A Amazon cobra sobre `produto + frete`; todos os outros, só sobre o produto. Isso não é um parâmetro — muda a fórmula. Virou o campo `commissionBase` (§3).
2. **Limiar de frete grátis.** ML acima de R$79 e Shopee em tudo transferem o frete ao vendedor. Isso decide *se* o frete entra no custo, e é política do canal, não taxa. Vai para `SHIPPING_POLICY` (§4.4).
3. **Reputação e região mudam o subsídio.** ML dá até 70% de desconto conforme reputação; Shopee subsidia 30–60% conforme região. São atributos da conta/destino, não do produto.
4. **Custo de plano do vendedor.** Amazon cobra R$2/item (Individual) ou R$19/mês (Profissional). O mensal é despesa fixa — pertence ao `FixedExpense` do Financial Intelligence, não à taxa por venda. O por-item é taxa fixa e cabe em `FeeTier.fixedFeeAmount`.
5. **Condição promocional com validade.** Magalu 9,9% para seller novo, Shein 30 dias sem comissão. **Já é suportado sem mudança nenhuma**: `MarketplaceRule` tem `effectiveFrom`/`effectiveTo` e o `resolveEffective` já filtra por data.

**A regra de fronteira que uso para decidir onde cada camada mora:** se o valor depende só de *preço e categoria*, é `FEE_RULE`. Se depende dos *atributos físicos* do produto (peso, dimensão) ou do *destino*, é custo logístico (`LogisticsCostReader`). Se é *mensal e independente de venda*, é despesa fixa. Misturar as três num payload só produziria uma tabela que não fecha em nenhum canal.

| Canal | Dimensões de variação | Taxa por item | Importável via API? |
|---|---|---|---|
| **Mercado Livre** | categoria × **tipo de anúncio** (Clássico 10–14%, Premium 15–19%) × faixa de preço | Desde **mar/2026**: custo variável **por peso e dimensões** para itens de R$19 a R$79 — substituiu a antiga tarifa fixa por faixa | ✅ Sim — `/sites/MLB/listing_prices?price=&category_id=` (público, sem OAuth). Já implementado, mas só num preço e num tipo de anúncio |
| **Shopee** | **faixa de preço** (dimensão dominante) × tipo de vendedor (CNPJ/CPF) × programas aderidos | ≤R$79,99: 20% + R$4 · R$80–99,99: 14% + R$16 · R$100–199,99: 14% + R$20 · ≥R$200: 14% + R$26. **Teto de R$100 removido em 2026.** CPF com >450 pedidos/90d: +R$3/item | ⚠️ Open Platform existe e o Kyneti já tem conexão OAuth, mas **não foi encontrado endpoint público de comissão** — provavelmente tabela oficial (`OFFICIAL_DOCS`) |
| **TikTok Shop** | categoria (6% na maioria, 5% em algumas) | Processamento de pagamento 1,02%–3,78% | ⚠️ Partner API existe; comissão por categoria não confirmada como endpoint. Tratar como `OFFICIAL_DOCS` até validar |
| **Amazon** | categoria (referral fee) × preço × programa (FBA/FBM) | Closing fee, tarifas FBA | ✅ **O melhor caso de todos** — SP-API `getMyFeesEstimate` devolve a estimativa **real por SKU/ASIN e preço**. Ver §4.2: pede um tipo de provider diferente |
| **Magalu** | categoria (definida em contrato comercial) | — | ⚠️ API existe (`developers.magalu.com`), comissão normalmente vem do contrato/portal, não de endpoint público |
| **Shein** | **flat 16%** sobre venda entregue | Frete co-participado por peso/dimensão | ⚠️ Integração via Secret Key/Open Key do Seller Hub; comissão é flat, então o custo de não ter API é baixo. 30 dias sem comissão para novo seller CNPJ |
| **Nuvemshop** | **Não é marketplace** — ver §5 | Tarifa de plano (0% / 2% / 1% / 0,7%) + gateway (Nuvem Pago: Pix 0,99%; cartão + R$0,35/transação) | ❌ Não há API de taxa. Ver §5 para a alternativa proposta |

### 2.1 O que esse quadro ensina

1. **Faixa de preço é a dimensão universal.** Aparece explicitamente na Shopee, no ML (limiar de R$79) e na Amazon. É a primeira coisa que o payload precisa representar.
2. **Tipo de anúncio é específico do ML, mas cara.** Clássico × Premium é uma diferença de 5 pontos percentuais — maior que a variação entre muitas categorias. Ignorar isso é um erro maior do que ignorar categoria.
3. **Peso e dimensão entraram na conta em 2026** (ML). Isso não cabe numa tabela de faixas de preço — é outra função. Ver §4.3.
4. **Nem todo canal permite importar.** Quatro dos sete provavelmente exigirão tabela oficial mantida à mão. O modelo precisa tratar isso como cidadão de primeira classe, não como gambiarra — e é exatamente para isso que `DataSourceType` já tem `OFFICIAL_DOCS` e `MANUAL`, e que `RuleStatus` tem `PENDENTE_VALIDACAO`.

---

## 3. Modelo proposto: a taxa vira uma tabela

```ts
// FRAÇÃO (0.14 = 14%) em TODO o sistema — ver §3.2.
export interface FeeTier {
  minPrice: number;        // inclusive
  maxPrice: number | null; // exclusive; null = última faixa, sem teto
  commissionPct: number;
  fixedFeeAmount: number;
}

export interface FeeRulePayload {
  tiers: FeeTier[];                  // ordenadas, contíguas, sem buraco nem sobreposição
  listingTypeId?: string;            // ML: gold_special (Clássico) / gold_pro (Premium)
  commissionCapAmount?: number | null; // teto por item (Shopee tinha R$100 até 2025)
  referencePrice?: number;           // legado — só no payload escalar antigo
}
```

Um único formato cobre os sete canais:

- **Shopee** — quatro faixas, exatamente como a tabela pública.
- **ML** — hoje uma faixa por (categoria × tipo de anúncio); quando as faixas forem sondadas (§4.1), várias.
- **Shein** — uma faixa só, `{ min: 0, max: null, commissionPct: 0.16, fixedFeeAmount: 0 }`.
- **TikTok/Magalu** — uma faixa por categoria.
- **Nuvemshop** — ver §5.

**Compatibilidade retroativa:** o validador aceita o payload escalar antigo e o normaliza para uma tabela de uma faixa só. Nenhuma regra já gravada precisa ser migrada, e o `contentHash` de uma regra antiga continua batendo com ela mesma (a normalização acontece na leitura, não na gravação).

### 3.1 `scopeKey` composto

`scopeKey` hoje é a categoria do canal (`MLB1234`). Para o ML, passa a ser `MLB1234#gold_special` — categoria e tipo de anúncio identificam regras diferentes, e o `resolveEffective` faz match exato. A resolução tenta, em ordem: `categoria#tipoDeAnúncio` → `categoria` → `GLOBAL`. Canais sem tipo de anúncio continuam usando `scopeKey` simples, sem mudança.

### 3.2 A unidade é fração, sempre

`commissionPct` é **fração (0–1)** em todo o sistema. Decisão registrada aqui porque a ambiguidade já custou um bug (§1.2):

- **Providers convertem na borda.** O do ML divide `percentage_fee` por 100 ao montar o candidato — o resto do sistema nunca vê percentual.
- **O validador rejeita > 1.** Uma comissão de 100%+ não é cenário real de marketplace; aceitar `14` como válido foi o que permitiu o bug passar. Rejeitar é a diferença entre "falha barulhenta no momento da importação" e "falha silenciosa três meses depois".
- **O nome do campo mente um pouco** (`Pct` sugere percentual). Mantido por já estar em uso em dois módulos e no banco; o comentário do contrato agora diz a unidade explicitamente. Renomear é mudança maior sem ganho proporcional.

---

## 4. Capacidades de provider — três padrões, não um

O `FeeRuleCapableProvider` atual assume que toda taxa é uma **tabela que dá para baixar**. Isso é verdade para o ML e para tabelas oficiais, mas não para a Amazon.

### 4.1 Tabela sondada (ML) — evolução do que já existe

O `listing_prices` responde para **um preço por vez**. Para descobrir as faixas, o provider sonda uma grade de preços (ex.: 25, 50, 79, 100, 200, 500) e **agrupa preços consecutivos com a mesma comissão** numa faixa. É engenharia reversa da tabela — funciona porque a API é determinística e pública.

Custo: hoje é 1 chamada por categoria; passa a ser `nº de preços × nº de tipos de anúncio` por categoria. Com 6 preços e 2 tipos, 12× mais chamadas. Aceitável para um job agendado (não é caminho de request), mas pede o `withRetry`/rate limiting que o projeto já tem em `shared/rate-limiting/`.

### 4.2 Cotação por item (Amazon) — capacidade nova

A SP-API `getMyFeesEstimate` recebe **SKU/ASIN + preço** e devolve a taxa estimada real, já considerando categoria, programa e FBA. Não faz sentido transformar isso numa tabela de faixas: é mais preciso e mais simples consultar na hora.

Proposta: uma capacidade separada, irmã da atual (Interface Segregation — o mesmo padrão que o projeto já usa para `ListingCapableProvider`/`PriceUpdateCapableProvider`):

```ts
export interface FeeQuoteCapableProvider extends MarketplaceProvider {
  quoteFee(ctx: FetchContext, params: { skuCode: string; price: number }): Promise<ResolvedFeeAtPrice>;
}
```

O `FeeRuleResolver` tenta a cotação ao vivo quando o canal a suporta, e cai para a tabela quando não. **Não implementar agora** — a Amazon ainda não está conectada; o valor de registrar aqui é garantir que o modelo de tabela não vire uma camisa de força que force a Amazon a caber onde não cabe.

### 4.3 Custo por peso/dimensão (ML 2026) — pertence à Logística, não à Taxa

A mudança do ML de março/2026 (tarifa fixa → custo variável por peso e dimensão para itens de R$19–79) **não é comissão** — é custo logístico que depende dos atributos físicos do produto, exatamente o que o `LogisticsCostReader` já resolve (`getTotalLogisticsCost(tenantId, skuCode, channelCode)`, que já recebe o canal).

Colocar isso no `FeeRulePayload` seria empurrar uma função de (peso, dimensões) para dentro de uma tabela de (preço) — dimensões erradas. O lugar certo é o `logisticsCost`, que o motor de preço **já consome** desde a correção de §1. Registrado aqui porque a tentação de modelar como "taxa" é real, e a fronteira só fica óbvia depois de escrita.

---

## 5. Nuvemshop — o canal que não é marketplace

A Nuvemshop é a **loja própria do vendedor**, não um marketplace. Não existe comissão porque não existe intermediário: o que existe é

1. **Tarifa por venda do plano** — 0% (Começo), 2% (Essencial), 1% (Impulso), 0,7% (Escala). É zero quando a venda passa pelo Nuvem Pago.
2. **Taxa do meio de pagamento** — Nuvem Pago: Pix 0,99%; cartão conforme parcelamento + R$0,35 por transação; boleto R$2,39. Se o lojista usa outro gateway (Mercado Pago, PagSeguro), são as taxas daquele gateway.

**Não há API pública de taxa** — e faz sentido que não haja: a tarifa depende do *plano contratado* e do *gateway escolhido*, dados da conta do lojista, não do catálogo.

### Alternativa proposta (a que o usuário pediu)

Já existe no projeto um `NuvemshopFeeRuleProvider` (citado em `platform-architecture.md` §2 como "a taxa de gateway da Nuvemshop") e o `MarketplaceProvider` já suporta `listTenantIdsToSync()`, para providers cuja regra é **por tenant**, não global. A infraestrutura está pronta; falta a fonte do dado. Três opções, em ordem de preferência:

**Opção A — Configuração assistida por tabela oficial (recomendada).** O lojista escolhe na tela: plano Nuvemshop + meio de pagamento. O sistema já traz as alíquotas publicadas pré-preenchidas (uma regra `OFFICIAL_DOCS` global, versionada como qualquer outra), e grava o resultado como uma `MarketplaceRule` de escopo do tenant. Vantagens: o lojista responde duas perguntas de menu em vez de digitar percentuais; quando a Nuvemshop mudar a tabela, atualiza-se a regra global e todos os tenants herdam (o `resolveEffective` já faz override de tenant sobre global); e o dado fica versionado e auditável igual ao resto.

**Opção B — Derivar do repasse real.** O Kyneti já importa repasse/settlement (`settlement-import.controller.ts`, `ReceivableReconciliationService`). Dá para inferir a taxa efetiva comparando o valor bruto do pedido com o líquido recebido. Mais fiel que qualquer tabela — é o que **de fato** foi cobrado —, mas só funciona *depois* da primeira venda liquidada, então não serve para precificar produto novo. **Melhor como validação cruzada da Opção A** ("a taxa que você configurou é 2%, mas o repasse real está saindo a 2,4% — revise") do que como fonte primária.

**Opção C — Digitação livre.** O lojista digita o percentual. É o que a maioria das ferramentas do mercado faz, e é o que o princípio do usuário quer evitar. Fica como escape hatch, não como caminho principal.

**Recomendação: A como padrão, B como auditoria quando houver repasse suficiente.** A Opção B é, na prática, um diferencial competitivo — nenhum dos concorrentes pesquisados em `market-landscape-analysis.md` menciona conferir a taxa configurada contra o repasse real.

---

## 6. O problema circular: o preço depende da taxa, que depende do preço

Consequência direta e não óbvia das faixas de preço. O piso é

```
P = (custo + logística + taxaFixa) / (1 − comissão − imposto − margem)
```

mas `comissão` e `taxaFixa` dependem da faixa em que `P` cai. Circular.

**Solução (função pura, testável):** para cada faixa, calcular o piso *assumindo* aquela faixa, e manter só as soluções **consistentes** — as que caem dentro da própria faixa que as gerou. Entre as consistentes, escolher a **menor** (melhor para o vendedor). Exemplo com a tabela real da Shopee, custo R$50, margem 10%:

- Faixa ≤R$79,99 (20% + R$4): `(50+4)/(1−0,20−0,10) = 77,14` → cai em ≤79,99 ✔ consistente
- Faixa R$80–99,99 (14% + R$16): `(50+16)/(1−0,14−0,10) = 86,84` → cai em 80–99,99 ✔ consistente

Duas soluções válidas; vence R$77,14. Faz sentido: vender a 77,14 pagando 20% deixa mais que vender a 86,84 pagando 14% + R$16.

**Caso sem solução consistente.** Pode acontecer perto de um limiar: toda faixa produz um preço fora de si mesma. Aí o piso real é o **limiar** — o menor limite de faixa cuja margem ainda satisfaz o mínimo. Se nem isso existir, é `UnreachableMarginError` (já criado em §1): o produto não fecha naquele canal com aquela margem, e a resposta honesta é dizer isso, não devolver um número inventado.

---

## 7. Status de implementação (01/08/2026)

**1136 testes passando (108 suítes), `tsc --noEmit` limpo.**

⚠️ **Duas mudanças de schema pendentes de migration:** `Warehouse.estimatedFreightCost` (aditivo, `@default(0)`) e o model novo `ChannelSellerProfile`. Rodar `npx prisma migrate dev` antes de subir.

### ✅ Implementado

| Item | Onde |
|---|---|
| `FeeTier` — comissão e taxa fixa por faixa de preço | `domain/marketplace-rule.entity.ts` |
| `commissionBase` (`ITEM_PRICE` / `ITEM_PRICE_PLUS_SHIPPING`) | idem — cobre a regra da Amazon |
| `commissionCapAmount` — teto por item | idem — cobre o modelo que a Shopee usou até 2025 |
| Validador: unidade fração, faixas contíguas de 0 ao ∞, retrocompatível com escalar | `domain/rule-payload-validators.ts` (+ spec) |
| `scopeKey` composto `categoria#tipoDeAnúncio` | `buildFeeScopeKey`, usado na gravação e na leitura |
| Resolução com fallback `categoria#tipo` → `categoria` → `GLOBAL` | `rule-registry.service.ts`, `pricing-decision.service.ts` |
| **Correção do bug de unidade** — conversão `/100` na borda do provider | `mercado-livre-fee-rule.provider.ts` |
| Sondagem de preços + agrupamento em faixas | `groupProbesIntoTiers` (+ spec) |
| Captura de Clássico **e** Premium | `LISTING_TYPES` no provider do ML |
| **Piso com resolução do problema circular** | `calculateTieredNetMarginFloorPrice` (+ spec com a tabela real da Shopee) |
| `resolveFeeAtPrice` — taxa efetiva a um preço, com teto e base de cálculo | `shared/contracts/fee-rule-resolver.port.ts` |
| Promoções e simulador Nuvemshop cientes de faixa | `promotion-intelligence.service.ts`, `nuvemshop-margin-simulator.service.ts` |

Três convenções de unidade coexistiam no repositório antes desta mudança (validador em 0–100, Promoções em fração, simulador Nuvemshop em percentual). Agora o contrato é **fração em todo lugar**, com a conversão isolada em dois pontos explícitos e comentados: a borda do provider (entrada) e o simulador da Nuvemshop (saída, porque `calculateNuvemshopMarginScenario` recebe percentual).

### ✅ Implementado — 2ª rodada (política de frete e perfil do vendedor)

| Item | Onde |
|---|---|
| `SHIPPING_POLICY` — faixas com `freeShippingRequired`, subsídio do canal (% e teto) | `domain/marketplace-rule.entity.ts`, `validateShippingPolicyPayload` |
| `resolveSellerFreightCost` — quanto do frete sai do bolso do vendedor | `shared/contracts/shipping-policy-resolver.port.ts` |
| **Faixas de taxa × faixas de frete combinadas** — resolve o duplo problema circular | `mergeFeeAndShippingBands` |
| `Warehouse.estimatedFreightCost` — frete médio por canal | schema + `LogisticsCostReader.getEstimatedFreightCost` |
| **`ChannelSellerProfile`** — o que ESTE vendedor contratou no canal | schema `marketplace_intelligence` + service + `PUT /marketplace-intelligence/seller-profiles/:channelCode` |
| **Plano de vendas profissional (Amazon)** — ativo isenta a tarifa por item | `FeeTier.planWaivablePerItemFee` + `applySellerProfileToTier` |
| **Desconto de frete por reputação (ML, até 70%)** | `ChannelSellerProfile.freightDiscountPct` |

**A distinção que estrutura tudo isso:** `MarketplaceRule` descreve como o **canal** cobra de todo mundo (importado, versionado, auditável). `ChannelSellerProfile` descreve o que **este vendedor** contratou (configurado, porque nenhum canal expõe por API "fulano assina o plano X"). Sem a separação, a única saída seria criar uma regra versionada por tenant só para registrar um dado de cadastro — poluindo o versionamento, que existe para rastrear mudanças do canal.

**Regra de omissão:** perfil não configurado = perfil **neutro** (paga a tarifa por item, paga o frete cheio, sem desconto). Sempre o lado conservador. Assumir um benefício inexistente calcularia preço a menor e viraria prejuízo silencioso — exatamente a classe de erro que a correção de §1 da revisão existiu para eliminar. Errar para mais, no pior caso, custa uma venda que não aconteceu.

### ⏳ Desenhado, não implementado — e por quê

| Item | Motivo de não fazer agora |
|---|---|
| **Subsídio por região (Shopee, 30–60%)** | A política já suporta `channelSubsidyPct` + teto por faixa de preço, mas não por região de destino — que depende do endereço do comprador, inexistente na hora de precificar. Caberia melhor num cálculo por pedido (DRE) que num piso de preço |
| **Tela do perfil do vendedor** | O endpoint existe (`GET`/`PUT /marketplace-intelligence/seller-profiles`), o frontend ainda não. É um formulário pequeno: um switch por canal + campo de reputação |
| **Tela do frete estimado por canal** | `Warehouse.estimatedFreightCost` existe no schema; falta o `PATCH` e o campo na tela de depósitos, ao lado do `logisticsCostPerUnit` que já está lá |
| **`FeeQuoteCapableProvider` (Amazon)** | A Amazon ainda não está conectada. `commissionBase` já garante que, quando estiver, a regra dela não será calculada errado |
| **Providers de Shopee, TikTok, Magalu, Shein, Nuvemshop** | Nenhum tem endpoint público de comissão confirmado. O caminho é regra `OFFICIAL_DOCS` mantida à mão — o modelo de faixas já representa todas elas, e o `RuleStatus`/versionamento já dá auditoria |
| **Faixas mais finas no ML** | A grade de sondagem (`PROBE_PRICES`) tem 8 pontos. Aumentar melhora a resolução ao custo de mais chamadas — mexer se aparecer canal com faixas mais estreitas |

### ⚠️ Efeito colateral a conhecer antes de sincronizar

O provider do ML passou de **1 chamada por categoria** para **8 preços × 2 tipos de anúncio = até 16 chamadas por categoria**. É job agendado, não caminho de request, mas vale ligar o `withRetry`/rate limiting que já existe em `shared/rate-limiting/` antes do primeiro sync real em produção.

E as regras `FEE_RULE` já gravadas em formato escalar continuam sendo lidas (normalizadas para faixa única) — **exceto** as que tiverem `commissionPct > 1`, que passam a falhar na leitura de propósito. Isso é o bug de unidade aparecendo: a regra estava errada, e reimportar é o conserto. O provider faz isso sozinho no próximo sync.

---

## 8. Fontes

- Mercado Livre — [API de preços](https://developers.mercadolivre.com.br/pt_br/api-de-precos) · [Comissões 2026 por categoria](https://www.gestorshop.com.br/blog/comissoes-mercado-livre-2026-tabela) · [Mudança de tarifa fixa para custo por peso, mar/2026](https://ecommercenapratica.com/blog/comissao-mercado-livre/)
- Shopee — [Política de Comissão CNPJ/CPF 2026 (oficial)](https://seller.shopee.com.br/edu/article/26839/Comissao-para-vendedores-CNPJ-e-CPF-em-2026) · [Fim do teto de R$100](https://www.ecommercebrasil.com.br/artigos/shopee-acaba-com-o-teto-de-comissao-de-r-100-e-aumenta-a-taxa-fixa-cobrada-por-cada-item-vendido-em-ate-550)
- Amazon — [Product Fees API](https://developer-docs.amazon.com/sp-api/docs/product-fees-v0-use-case-guide) · [getMyFeesEstimates](https://developer-docs.amazon.com/sp-api/reference/getmyfeesestimates)
- TikTok Shop — [Fees 2026](https://www.dashboardly.io/post/tiktok-shop-fees-2026-the-complete-seller-fee-guide)
- Magalu — [Magalu Devs — APIs de Marketplace](https://developers.magalu.com/docs/apis/)
- Shein — [Política de Comissão (oficial)](https://br.shein.com/SHEIN-Commission-Policy-a-1420.html)
- Nuvemshop — [Taxas e tarifas do Nuvem Pago](https://atendimento.nuvemshop.com.br/pt_BR/informacoes-gerais-nuvem-pago/quais-sao-as-taxas-e-tarifas-do-nuvem-pago) · [Planos e preços](https://www.nuvemshop.com.br/planos-e-precos)
