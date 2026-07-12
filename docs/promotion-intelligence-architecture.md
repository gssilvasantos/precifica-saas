# Promotion Intelligence — Motor de Cálculo de Margem para Promoções (Sprint 26)

**Status:** módulo novo, completo end-to-end (schema, domínio, aplicação, infraestrutura, interface). Bounded context próprio — não estende nenhum módulo existente.

## 1. O pedido e por que virou um módulo próprio

Pedido original: validar a viabilidade de uma promoção **antes** dela ser ativada de verdade — um "Semáforo de Margem" (VERDE/VERMELHO) que bloqueia proativamente a adesão de um SKU a uma campanha quando a margem líquida resultante seria negativa. A fórmula pedida: `M.C. Líquida = Preço - Taxas - Custos - Logística`.

Isso não é uma extensão de `pricing-intelligence` (que decide o preço de venda corrente) nem de `catalog` (que só descreve o produto): é uma pergunta diferente — "se eu vender a X reais numa campanha, ainda sobra margem?" — respondida antes de qualquer pedido real existir. Daí o módulo próprio `promotion-intelligence`.

## 2. Refinamento pedido no meio do desenho: hierarquia de custo de embalagem

O desenho inicial usava um custo logístico fixo por depósito (`Warehouse.logisticsCostPerUnit`). O usuário pediu um refinamento antes de qualquer código: o custo de embalagem não pode ser fixo — precisa vir do módulo de embalagens (`catalog`), com uma hierarquia de resolução:

1. **Prioridade 1 — Kit/Combo:** se o produto é um kit (`Product.isKit === true`), usa o custo da "Embalagem de Agrupamento" vinculada especificamente a ele (`Packaging.purpose === 'GROUPING'`, resolvida pelo mesmo `packagingId` do produto — sem campo novo).
2. **Prioridade 2 — Agrupamento Dinâmico (multi-SKU):** para pedidos com SKUs variados, calcular o cubado total e aplicar uma "Embalagem Master" (`Packaging.purpose === 'MASTER'`) em vez de somar embalagens individuais. **Conceito de pedido real, não de avaliação pré-venda** — ver seção 5, gap explícito.
3. **Prioridade 3 — Default/Segurança:** sem definição nenhuma, aplica a "Embalagem de Segurança" (`Packaging.purpose === 'SAFETY_DEFAULT'`, tipicamente a de maior custo do tenant) para manter a margem calculada conservadora.

Investigação antes de desenhar: nenhum dos três conceitos (kit, tiering de embalagem, agrupamento dinâmico) existia em `catalog` antes desta sprint — greenfield total. Extensões feitas por economia, reaproveitando campos existentes:

- `Product.isKit: boolean` — novo campo, mas **reaproveita o `packagingId` já existente** para apontar para a embalagem de agrupamento do kit, em vez de criar um segundo campo `groupingPackagingId`.
- `Packaging.purpose: PackagingPurpose` (`STANDARD | GROUPING | MASTER | SAFETY_DEFAULT`) + `Packaging.maxCapacityKg: Float?` — estende a entidade já existente, em vez de uma tabela nova de "tiers".

## 3. `LogisticsCostReader` — a porta que compõe embalagem + operacional

Nova porta compartilhada (`shared/contracts/logistics-cost-reader.port.ts`, token `LOGISTICS_COST_READER`), implementada por `LogisticsCostReaderService` (módulo `logistics-fulfillment`, que já possui `Warehouse` e agora também `Warehouse.logisticsCostPerUnit`):

```ts
interface LogisticsCostReader {
  getTotalLogisticsCost(tenantId, skuCode, channelCode): Promise<number>;
  getPackagingCostForOrder(tenantId, items: {skuCode, quantity}[]): Promise<number>; // Prioridade 2, reservado
}
```

`getTotalLogisticsCost` — o único método consumido pelo Motor de Margem — resolve em paralelo (1) o custo de embalagem via a hierarquia (Prioridades 1 e 3 apenas — ver seção 5) e (2) `Warehouse.logisticsCostPerUnit` do CD Full do canal (`WarehouseService.ensureFullWarehouse`), somando os dois. Consome `PRODUCT_CATALOG_READER` (para saber se o produto é kit e seu `packagingId`) e a nova porta `PACKAGING_COST_READER` (implementada por `PackagingsService`, em `catalog`) para os custos de embalagem propriamente ditos. Se nada resolver (sem embalagem vinculada, sem segurança cadastrada), assume 0 e emite um `logger.warn` — nunca lança, nunca inventa um valor.

**Sem dependência circular:** `logistics-fulfillment` já importava `catalog` (Sprint 26 estendeu esse import para também consumir `PACKAGING_COST_READER`); `catalog` não importa `logistics-fulfillment` de volta.

## 4. O Motor de Margem propriamente dito

### 4.1 `domain/margin-calculator.ts` — puro, sem I/O

- `calculateNetMargin(inputs)` — `feesAmount = preço×comissão + taxa fixa`, `taxAmount = preço×alíquota`, `netMarginAmount = preço − taxas − custo do produto (SEM embalagem) − logística (embalagem + operacional, já composta)`. **Zero é tratado como VERMELHO**, não como um terceiro estado neutro — mesmo racional defensivo do piso financeiro do `PricingStrategist` (Etapa 13): na dúvida, bloqueia.
- `canEnrollInPromotion(result)` — gate puro, mesmo padrão de `canApprove`/`canMarkDivergent` (Hub de Provas, Sprint 24): só permite adesão `APPROVED` se `marginStatus === 'VERDE'`.

**Cuidado deliberado contra dupla contagem:** o "Custos" da fórmula usa só `Product.costPrice` (custo do produto), nunca o custo efetivo que já inclui embalagem (exposto por `CatalogReaderService` desde a Etapa 14) — porque a embalagem inteira já entra por dentro de "Logística" via `LogisticsCostReader`. Somar os dois contaria a embalagem duas vezes.

### 4.2 `PromotionIntelligenceService` — orquestração

- `computeMargin(tenantId, skuCode, channelCode, promotionalPrice)` — pré-visualização pura, não grava nada. Busca o produto (`PRODUCT_CATALOG_READER`), a regra de comissão (`FEE_RULE_RESOLVER`, com `categoryCode: 'GLOBAL'` — convenção documentada, já que `Product` não tem campo de categoria de marketplace), a política fiscal (`FINANCIAL_POLICY_READER`, Etapa 13) e o custo logístico composto (`LOGISTICS_COST_READER`), monta `MarginInputs` e chama `calculateNetMargin`. Devolve `feeRuleFound: boolean` (mesmo padrão de transparência do `NuvemshopMarginSimulatorService`) — se nenhuma regra de comissão for encontrada, a comissão é assumida 0 e o flag avisa a UI que a margem mostrada pode ser otimista demais.
- `validateEnrollment(tenantId, campaignId, skuCode, promotionalPrice)` — resolve a campanha (`PromotionCampaignService.getOwned`, valida posse do tenant), usa o `channelCode` **da campanha** (nunca perguntado de novo), chama o mesmo cálculo de `computeMargin`, aplica `canEnrollInPromotion` e persiste um `PromotionEnrollment` via `upsert` (chave `campaignId_skuCode`) com o **snapshot completo** do cálculo — mesmo racional de `OrderItem.costPriceUsed` (Etapa 19): nunca recalculado silenciosamente depois; reavaliar é chamar `validateEnrollment` de novo, que sobrescreve a mesma linha.

### 4.3 Deliberadamente NÃO criado: `ConfiguracaoCanal`

O desenho original do usuário sugeria uma entidade de configuração por canal. Não foi criada — taxa/comissão já vêm de `MarketplaceRule`/`FEE_RULE_RESOLVER` e a política fiscal já vem de `CatalogSettings`/`FINANCIAL_POLICY_READER`; duplicar qualquer um dos dois aqui criaria duas fontes de verdade divergentes para o mesmo dado.

## 5. Gap explícito: Prioridade 2 (Agrupamento Dinâmico) não é consumida ainda

"Agrupamento Dinâmico" — cubagem de múltiplos SKUs de um pedido real para escolher uma Embalagem Master — é inerentemente um conceito de **pedido**, com itens de verdade e quantidades reais. O Motor de Margem de promoções avalia **um SKU único, antes de qualquer pedido existir** — não há "pedido" para cubar. Por isso:

- `LogisticsCostReader.getPackagingCostForOrder(tenantId, items)` foi construído como método **forward-looking**, correto e testado, mas **não é chamado por nenhum consumidor ainda** — reservado para uma futura integração com `orders`/`financial-intelligence` (CMV real por pedido no DRE, mesmo ponto de extensão já citado como gap aberto em `docs/logistics-fulfillment-architecture.md`, seção 6).
- `PromotionIntelligenceService` só exercita as Prioridades 1 (kit) e 3 (default/segurança) do `LogisticsCostReader` — nunca a 2.

## 6. Interface HTTP

| Rota | Guarda | Descrição |
|---|---|---|
| `POST /promotion-intelligence/campaigns` | ADMIN/PRICING_EDITOR | Cria campanha (`name`, `channelCode`, `startAt`, `endAt`) — valida `startAt < endAt` |
| `GET /promotion-intelligence/campaigns` | autenticado | Lista campanhas do tenant |
| `GET /promotion-intelligence/campaigns/:id` | autenticado | Consulta uma campanha (valida posse) |
| `GET /promotion-intelligence/campaigns/:id/margin-preview?skuCode=&promotionalPrice=` | autenticado | Pré-visualização pura do semáforo — não grava nada |
| `POST /promotion-intelligence/campaigns/:id/enrollments` | ADMIN/PRICING_EDITOR | Adesão de um SKU — **sempre responde 201**, mesmo quando bloqueado (o bloqueio é um dado de negócio para a UI mostrar, não um erro HTTP) |
| `GET /promotion-intelligence/campaigns/:id/enrollments` | autenticado | Lista adesões (aprovadas e bloqueadas) da campanha |

## 7. Migração e limitação de ambiente (honestidade)

Migração hand-written em `prisma/migrations/20260711200000_promotion_intelligence/migration.sql` — cria o schema `promotion_intelligence`, as tabelas `promotion_campaigns`/`promotion_enrollments`, o enum `PackagingPurpose` e as colunas novas em `warehouses`/`packagings`/`products`. Não pôde ser validada contra um Postgres/Prisma Engine real neste sandbox (`npx prisma generate`/`migrate dev` bloqueados por rede — `403` ao buscar os binários do engine, confirmado novamente nesta sprint mesmo com `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`). Recomendação: rodar `npx prisma migrate dev` no ambiente real antes de subir esta sprint.

**Limitação adicional descoberta nesta sprint (pré-existente, não introduzida agora):** o Prisma Client gerado localmente neste sandbox está parado desde as primeiras etapas do projeto — só contém os models `User` e `Product`. Isso faz `npx tsc --noEmit` no projeto inteiro falhar hoje para **todo** repositório Prisma cujo model não esteja no client local (`packaging`, `fixedExpense`, `receivableRecord`, `stockLedgerEntry`, `mercadoLivreConnection`, `order`, `promotionCampaign`, `promotionEnrollment` etc.) — nenhum desses erros é um bug de código, e nenhum é específico desta sprint. A verificação confiável neste ambiente é `npx jest <módulo>` por módulo (que mocka os repositórios via porta, sem precisar do client real) — método usado para validar toda a Sprint 26. Resolve-se sozinho assim que `npx prisma generate`/`migrate dev` forem executados no ambiente real do usuário.

## 8. Testes

- `domain/margin-calculator.spec.ts` — 7 casos: VERDE, VERMELHO, zero-é-VERMELHO, rejeita preço ≤ 0, logística reduz a margem proporcionalmente, gate permite VERDE, gate bloqueia VERMELHO com motivo.
- `application/promotion-campaign.service.spec.ts` — criação (sucesso e rejeição de janela inválida), `getOwned` (sucesso e `NotFoundException`).
- `application/promotion-intelligence.service.spec.ts` — 12 casos: `computeMargin` VERDE/VERMELHO, `feeRuleFound: false` quando não há regra, `NotFoundException` para SKU inexistente, uso do custo logístico composto; `validateEnrollment` aprovado/bloqueado com motivo, resolução do canal a partir da campanha (nunca perguntado de novo), campanha inexistente nunca chega a consultar o catálogo.
- Repositórios Prisma (`PrismaPromotionCampaignRepository`/`PrismaPromotionEnrollmentRepository`) não têm teste unitário próprio — mesmo padrão de todo repositório Prisma já existente na plataforma (nenhum tem `.spec.ts`; dependem de banco real).

Total: 20 testes novos, todos passando (`npx jest promotion-intelligence`). Módulos consumidos/estendidos (`catalog`, `logistics-fulfillment`, `orders`, `financial-intelligence`) reverificados sem regressão: 13 + 58 + 89 testes, todos passando.
