# Pricing Intelligence — Arquitetura

**Status:** primeira fatia (simulador de margem Nuvemshop, Etapa 5.1) + núcleo de decisão de preço (`PricingStrategist`) + modo operação (flag `autoRepricingEnabled` por SKU + aplicação automática/manual via `PRICE_UPDATE_DISPATCHER`, seção 7) + governança financeira (piso por imposto + margem líquida mínima global do tenant, seção 8) + Packaging Intel (custo e peso efetivos quando o produto tem embalagem vinculada, seção 9). Motor de preço completo do PRD (preço ideal, não só o piso; múltiplas estratégias) ainda não existe — ver seção 6.

**Nota de nomenclatura:** o PRD e algumas conversas chamam este bounded context de "Pricing Engine". No código ele sempre se chamou `pricing-intelligence` (`modules/pricing-intelligence/`) — é o mesmo módulo, mantive o nome já em uso em vez de criar um `pricing-engine` paralelo.

## 1. Objetivo

Decidir o preço de um produto a partir de dois insumos: a estrutura de custo/margem do produto (Catalog) e a situação competitiva atual (Competition Intelligence). O resultado é uma `PricingDecision` — uma recomendação, não uma aplicação automática de preço (ver seção 5 sobre por que essa fronteira existe deliberadamente).

## 2. `PricingStrategist` — o núcleo de domínio

```typescript
// domain/pricing-strategist.ts
export interface PricingContext {
  skuCode: string;
  costPrice: number;
  currentPrice: number;
  desiredMarginPct: number; // margem-alvo do produto
  minimumMarginPct: number; // piso de segurança — a invariante que nunca pode ser furada
  competitorBestPrice: number | null; // null quando não há leitura de concorrência ainda
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
}

export type PricingAction = 'MATCH_COMPETITOR' | 'HOLD_PRICE' | 'SAFETY_FLOOR_APPLIED';

export interface PricingDecision {
  skuCode: string;
  action: PricingAction;
  recommendedPrice: number;
  currentPrice: number;
  resultingMarginPct: number;
  safetyFloorPrice: number; // sempre calculado, mesmo quando não é o preço escolhido
  hitSafetyFloor: boolean;
  reason: string;
}

export interface PricingStrategist {
  calculateOptimalPrice(context: PricingContext): PricingDecision;
}
```

100% domínio puro: sem NestJS, sem Prisma, sem `import` de porta nenhuma. Recebe dado simples, devolve dado simples — a mesma separação já usada em `opportunity-calculator.ts` (Competition Intelligence) e `nuvemshop-margin-calculator.ts`.

**Por que interface, e não uma função solta** (diferente das outras calculadoras do projeto): "Strategist" é Strategy Pattern de propósito — hoje existe uma implementação (`DefaultPricingStrategist`), mas o contrato já existe para uma agressiva (subcotar por X%), conservadora (só reage a gaps grandes) ou orientada por IA no futuro, todas trocáveis via binding de DI sem tocar em quem consome.

## 3. A regra de ouro — como a margem mínima é garantida

`DefaultPricingStrategist.calculateOptimalPrice` roda em duas fases, nessa ordem — a ordem é o que garante a invariante:

1. **Sugestão competitiva "crua"**: `LOSING` → igualar o preço do concorrente; `WINNING`/`UNKNOWN` → manter o preço atual.
2. **Gate de segurança, incondicional**: calcula `safetyFloorPrice = costPrice / (1 - minimumMarginPct/100)` (inversão da fórmula de margem sobre preço de venda) e, se a sugestão da fase 1 cair abaixo dele — **por qualquer motivo, inclusive o preço atual já estar errado antes de qualquer evento de concorrência** — o preço de segurança vence. `action` vira `SAFETY_FLOOR_APPLIED` e a `reason` explica os dois lados (o que a estratégia queria fazer e por que foi bloqueada).

Testado em `default-pricing-strategist.spec.ts`: concorrente acima do piso → `MATCH_COMPETITOR`; concorrente abaixo do piso → `SAFETY_FLOOR_APPLIED` (nunca o preço do concorrente); e o caso defensivo — preço atual já abaixo do piso mesmo vencendo o Buy Box → ainda assim `SAFETY_FLOOR_APPLIED`. Rodar com `npm test -- default-pricing-strategist`.

## 4. Desacoplamento — por que o Strategist nunca conhece um `MarketplaceProvider`

Pergunta direta do pedido, resposta em duas partes:

1. **O Strategist não tem portas, não tem I/O.** `calculateOptimalPrice` recebe um `PricingContext` já montado — números e um enum. É estruturalmente impossível para ele chamar um `MarketplaceProvider`, porque ele não tem acesso a nenhum mecanismo de injeção de dependência nem a `shared/contracts/`.
2. **Quem monta o `PricingContext`** é `PricingDecisionService` (`application/pricing-decision.service.ts`) — e ele também não conhece `MarketplaceProvider`. Ele só injeta duas portas: `PRODUCT_CATALOG_READER` (custo e margens do produto, via Catalog) e `COMPETITOR_SNAPSHOT_READER` (a oportunidade competitiva já calculada, via Competition Intelligence — inclusive `ourPrice`, resolvido lá a partir do `ChannelListing` vinculado ao monitoramento). Nenhuma dessas portas expõe qual marketplace está por trás; `PricingDecisionService` não sabe se o produto está na Nuvemshop, no Mercado Livre ou na Shopee.

Quando este módulo precisar **aplicar** um preço (não só recomendar), o caminho já existe e segue a mesma disciplina: `PRICE_UPDATE_DISPATCHER` (Etapa 8) — que também não expõe qual provider/canal está por trás. A cadeia completa (`PricingStrategist` → `PricingDecisionService` → `PRICE_UPDATE_DISPATCHER`) nunca precisa importar um `MarketplaceProvider` concreto em nenhum ponto.

## 5. Pipeline: sinal → decisão → aplicação (condicional)

```
Competition Intelligence          Pricing Intelligence
─────────────────────             ────────────────────
CompetitionMonitorOrchestrator
  detecta mudança
  emite competition.buy-box-lost ──▶ CompetitorSignalListener.handleBuyBoxLost()
                                        │
                                        ▼
                                     PricingDecisionService.decideAndMaybeApply(tenantId, skuCode)
                                        │ resolveDecision(): busca PRODUCT_CATALOG_READER + COMPETITOR_SNAPSHOT_READER
                                        │                    chama PricingStrategist.calculateOptimalPrice(context)
                                        ▼
                                     product.autoRepricingEnabled?
                                        │
                              ┌─────────┴─────────┐
                              false                true
                              │                     │
                              ▼                     ▼
                       decisão LOGADA         dispatchDecision():
                       (não aplicada)           CHANNEL_LISTING_READER.findBySku() → externalId
                                                PRICE_UPDATE_DISPATCHER.dispatch()
```

`GET /pricing-intelligence/decisions/:skuCode` roda `decide()` sozinho (só cálculo, nunca aplica) — inspeção sob demanda, sem esperar um evento real do radar. `POST /pricing-intelligence/apply/:skuCode` (seção 7) é o caminho manual de aplicação, equivalente ao ramo `true` do diagrama acima, mas disparável a qualquer momento, independente do valor da flag.

## 6. O que falta para o motor de preço completo do PRD

- Reagir também a `PRICE_CHANGED` e `NEW_COMPETITOR_DETECTED` (hoje só `BUY_BOX_LOST` aciona `PricingDecisionService`) — decisão de escopo, não lacuna técnica: perder o Buy Box é o sinal mais claro de que vale recalcular; os outros dois eventos continuam só logados.
- Estratégias alternativas (`PricingStrategist` agressivo/conservador) — o contrato já suporta, falta implementar e decidir como selecionar a estratégia por tenant/produto.
- Preço "ideal" (baseado em `desiredMarginPct`, não só o piso) como uma segunda recomendação ao lado do preço de segurança — hoje `desiredMarginPct` só é validado, não usado na decisão.
- Um workflow de aprovação humana antes de aplicar, para tenants que quiserem uma etapa intermediária entre "log" e "automação total" (hoje é binário: `autoRepricingEnabled` ligado ou desligado) — mencionado no PRD, não desenhado ainda.
- Tela de front-end para o botão "Aplicar Preço Agora" (o endpoint já existe, ver seção 7) e para ligar/desligar `autoRepricingEnabled` por produto.

## 7. Modo operação — `autoRepricingEnabled` e aplicação de preço

**A flag.** `Product.autoRepricingEnabled: boolean` (schema Prisma, catalog), default `false` — opt-in por SKU, não uma configuração global de tenant. Exposta em `ProductCatalogSummary` (shared/contracts) e editável via `POST/PATCH /products` normal (não é campo travado por `sourceSystem`, ver `product-ownership-rules.ts` — é estratégia de precificação da Precifica, não um fato físico do produto).

**Caminho automático** (`PricingDecisionService.decideAndMaybeApply`, chamado pelo `CompetitorSignalListener` no evento `competition.buy-box-lost`): calcula a decisão e só a aplica se `product.autoRepricingEnabled === true`. Quando desligada, o comportamento é idêntico ao de antes desta etapa — só loga.

**Caminho manual** (`PricingDecisionService.applyDecision`, chamado por `POST /pricing-intelligence/apply/:skuCode`, ADMIN): recalcula a decisão na hora (nunca reaproveita uma decisão antiga, para não aplicar preço com dado desatualizado) e **sempre** tenta aplicar — independente da flag. É o "clique no botão Aplicar Preço Agora" pedido, para operar mesmo com a automação desligada.

Os dois caminhos convergem no mesmo método privado, `dispatchDecision`, que:

1. Não faz nada se `recommendedPrice === currentPrice` (nada mudou — evita chamar a API do canal à toa).
2. Resolve o `channelCode` a partir da `CompetitiveOpportunity` (novo campo — é o canal que gerou o `ourPrice` usado na comparação; ver `CompetitionMonitorOrchestrator`, que agora grava `channelCode: listing.channelCode` junto com a oportunidade).
3. Busca o `externalId` daquele SKU naquele canal via `CHANNEL_LISTING_READER.findBySku`.
4. Chama `PRICE_UPDATE_DISPATCHER.dispatch({ tenantId, marketplaceCode: channelCode, skuCode, externalId, newPrice: recommendedPrice })`.

Cada passo tem uma saída de "não aplicado" com motivo explícito (sem canal vinculado, sem anúncio encontrado, dispatcher recusou) — nunca uma exceção não tratada, mesma filosofia de "resultado de negócio" do resto da plataforma. `ApplyDecisionResult { decision, applied, reason, dispatchOutcome? }` é o formato de retorno dos dois métodos e do endpoint `POST /apply/:skuCode`.

## 8. Governança financeira — piso por imposto + margem líquida mínima global

**Correção de premissa, para registro:** não existe (nem existiu) uma tabela `TenantConfig` no projeto. A estrutura equivalente — configuração singleton por tenant, já usada para governar margens por SKU — é `CatalogSettings` (schema `catalog`, Etapa 5). Estendi essa tabela em vez de criar uma segunda tabela de configuração de tenant redundante.

**Os dois campos novos**, em `CatalogSettings`:

```prisma
model CatalogSettings {
  // ...campos já existentes (defaultDesiredMarginPct, defaultMinimumMarginPct)...
  taxRatePct         Float @default(0) // alíquota efetiva estimada (%)
  minProfitMarginPct Float @default(0) // margem líquida mínima GLOBAL (%)
}
```

Default `0` — a política nunca inventa um piso que o tenant não configurou; até lá, o piso financeiro colapsa para `custo / (1 - 0) = custo` (nunca mais restritivo que o piso por produto, que sempre existiu).

**Distinção importante:** `defaultMinimumMarginPct`/`Product.minimumMarginPct` é um piso **por SKU** (cada produto pode ter o seu). `taxRatePct`/`minProfitMarginPct` é um piso **global do tenant**, sempre em vigor, independente da margem configurada em cada produto — por isso são conceitos e endpoints separados (`GET/PUT /catalog/settings` para margens, `GET/PUT /catalog/settings/financial-policy` para a política financeira).

**A porta compartilhada:**

```typescript
// shared/contracts/financial-policy-reader.port.ts
export interface FinancialPolicy {
  taxRate: number;        // fração (0 a <1) — bate com a fórmula, não é percentual
  minProfitMargin: number;
}
export interface FinancialPolicyReader {
  getPolicy(tenantId: string): Promise<FinancialPolicy>;
}
```

Implementada por `FinancialPolicyReaderService` (Catalog), consumida por `PricingDecisionService` — token `FINANCIAL_POLICY_READER`.

**Eficiência — como evitar consulta pesada a cada cálculo:** `CatalogSettings` já é um lookup por chave primária (uma linha por tenant — não é, tecnicamente, uma "consulta pesada"), mas um motor de repricing em lote pode chamar isso centenas de vezes por segundo. Em vez de introduzir Redis só para isso (nada mais na stack usa cache distribuído ainda), `FinancialPolicyReaderService` mantém um **cache em memória, por processo**, com TTL de 5 minutos (`Map<tenantId, {policy, expiresAt}>`). Invalidação não depende só do TTL: `CatalogSettingsService.updateFinancialPolicy` emite `catalog-settings.financial-policy-updated` (mesmo `EventEmitter2` usado no resto da plataforma) assim que a política muda, e o reader assina esse evento para limpar a entrada na hora — uma mudança de política vale a partir do próximo cálculo, não depois de o TTL expirar.

**Limitação honesta:** esse cache é local ao processo. Se a API um dia rodar em múltiplas instâncias, cada uma teria sua cópia e a invalidação via `EventEmitter2` (in-process) não alcançaria as outras — nesse cenário a invalidação precisaria virar um evento publicado de verdade (Redis pub/sub ou o broker que a extração de serviço adotar, ver `platform-architecture.md`, seção 9). Não resolvido aqui porque a plataforma ainda roda como monólito de um processo só.

**Fórmula do piso financeiro** (pedida explicitamente): `FloorPrice = costPrice / (1 - (taxRate + minProfitMargin))` — `calculateFinancialFloorPrice` em `domain/pricing-strategist.ts`, mesmo arquivo do piso por produto (`calculateSafetyFloorPrice`).

**Onde a regra é aplicada — duas camadas, de propósito, não redundância acidental:**

1. **Dentro do `PricingStrategist`** (`DefaultPricingStrategist.calculateOptimalPrice`): calcula os DOIS pisos (por produto e financeiro) e usa o **maior dos dois** como piso efetivo. `action` vira `SAFETY_FLOOR_APPLIED` ou `FINANCIAL_FLOOR_APPLIED` dependendo de qual dos dois venceu — a mensagem é honesta sobre o motivo real. Isso é uma extensão pura de domínio: `PricingContext` ganhou `taxRate`/`minProfitMargin` como mais dois números, exatamente como `minimumMarginPct` já era — o Strategist continua sem I/O, continua sem saber que `CatalogSettings` existe.
2. **Em `PricingDecisionService.resolveDecision`, depois de receber a decisão**: um segundo gate, independente, recalcula o piso financeiro e sobrescreve `recommendedPrice` se a decisão do strategist ainda assim vier abaixo dele, anexando a nota exata pedida: *"Preço ajustado para o piso financeiro por proteção de margem"*. Isso não é redundância por acaso — é **defesa em profundidade deliberada**: o piso por produto é uma regra da ESTRATÉGIA (pode variar entre implementações de `PricingStrategist`), mas o piso financeiro é uma invariante de GOVERNANÇA do tenant, que deve valer não importa qual `PricingStrategist` esteja plugado. Se um dia uma estratégia customizada esquecer de aplicar o piso financeiro corretamente, este gate ainda protege o tenant.

Testado em `default-pricing-strategist.spec.ts` (qual piso vence quando) e `pricing-decision.service.spec.ts` (o gate da camada de aplicação sobrescrevendo a sugestão do strategist mockado).

## 9. Packaging Intel — custo e peso efetivos quando o produto tem embalagem vinculada

**O cadastro.** `Packaging` (schema `catalog`): `id, tenantId, name, weightG, heightCm, widthCm, lengthCm, costPrice, stockQuantity, isActive`. Reutilizável entre produtos (uma caixa 20x15x10 serve para vários SKUs) — CRUD próprio (`PackagingsService`/`PackagingController`, `/packagings`), mesmo padrão de `SuppliersService`. `Product.packagingId String?` é o vínculo opcional; ausência de vínculo (`null`) preserva o comportamento anterior a esta etapa integralmente.

Unidade deliberadamente diferente do resto do schema: `weightG` (gramas), porque é assim que fornecedores de embalagem especificam na prática — diferente de `Product.weightKg`, que descreve o produto físico. A conversão para Kg acontece uma única vez, na borda, em `resolveShippingDimensions`.

**Pergunta do pedido: como garantir que o estrategista saiba que o custo subiu se eu trocar a embalagem?**

Resposta curta: **`PricingStrategist`/`DefaultPricingStrategist`/`PricingDecisionService` não mudam NADA.** A resposta inteira mora uma camada abaixo, no `ProductCatalogReader` (a porta que `PricingDecisionService` já consumia desde a seção 4):

```typescript
// catalog/application/catalog-reader.service.ts — findBySku
const packaging = product.packagingId
  ? await this.packagings.findById(tenantId, product.packagingId)
  : null;

return {
  // ...
  costPrice: product.costPrice + (packaging?.costPrice ?? 0), // custo EFETIVO
  productCostPrice: product.costPrice,                         // breakdown, só transparência
  packagingCostPrice: packaging?.costPrice ?? null,
};
```

Isso é lido **sem nenhum cache**, do banco, em toda chamada a `findBySku` — que é toda chamada a `PricingDecisionService.decide()`/`decideAndMaybeApply()`/`applyDecision()`. Trocar `Product.packagingId` para outra embalagem, ou editar `Packaging.costPrice` de uma embalagem já vinculada, tem efeito na PRÓXIMA decisão calculada, sem qualquer invalidação manual — porque não há nada para invalidar.

Isso é uma escolha deliberada, e diferente da `FinancialPolicyReaderService` (seção 8), que tem cache de 5 minutos com invalidação por evento: política fiscal/margem-tenant muda raramente (é aceitável a decisão operar com até 5 minutos de atraso após uma edição). Custo de aquisição — e agora custo de embalagem — é o dado mais sensível de todo o cálculo de piso; qualquer atraso aqui significa correr o risco de vender abaixo do custo real. Por isso: zero cache nesse caminho, sempre.

**Peso cubado.** Mesma lógica de "sobreposição", só que para dimensões/peso de embalagem, resolvida em `resolveShippingDimensions` (domínio puro, `catalog/domain/`): se o produto tem `packaging` vinculada, as dimensões e o peso de embalagem usados no cálculo de peso cubado (`ShippingWeightCalculator`, Logistics Intelligence) são os da `Packaging`, não os campos manuais do produto; sem vínculo, os campos do produto passam adiante sem alteração. `ProductsService.create()`/`update()` chamam essa função antes de invocar `SHIPPING_WEIGHT_CALCULATOR` — e, em `update()`, **trocar só o `packagingId`** (nenhum campo físico do produto em si) já é suficiente para disparar o recálculo (`packagingChanged` entra na mesma condição de `weightInputsChanged`), exatamente para não deixar o peso cubado desatualizado silenciosamente.

**Log de consumo — `PackagingUsageEvent` (para o futuro DRE).** Tabela append-only: `tenantId, productId` (referência solta, não FK — mesmo padrão de `ChannelListing`/`CompetitiveOpportunity`: histórico não pode ficar acoplado ao ciclo de vida do `Product`), `packagingId` (FK real, `Packaging` só é soft-deleted), `quantity`, `unitCostPrice` (cópia **congelada** do custo no momento do evento — não uma referência viva a `Packaging.costPrice`, porque o DRE de um período passado precisa do custo histórico real, mesmo que o fornecedor reajuste depois), `occurredAt`.

**Honestidade técnica:** não existe hoje um módulo de Vendas/Pedidos que dispare isso automaticamente quando "um produto é vendido". O que existe é o mecanismo pronto: `PackagingUsageEventsService.record(tenantId, { productId, packagingId, quantity })` + `POST /packaging-usage-events` (manual). Quando um módulo de Vendas existir, ele chama esse mesmo `record()` no momento em que confirma uma venda — nada na tabela, na porta ou no serviço precisa mudar.

Testado em `shipping-dimensions-resolver.spec.ts` (passthrough sem embalagem, sobreposição com embalagem, conversão g→Kg, peso do produto nunca substituído), `catalog-reader.service.spec.ts` (custo efetivo com/sem embalagem) e `products.service.spec.ts` (trocar só `packagingId` dispara recálculo de peso; `packagingId` inválido para o tenant é rejeitado antes de chamar o calculador de peso).
