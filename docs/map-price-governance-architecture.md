# Política de Preço Mínimo (MAP) — arquitetura

**Status: IMPLEMENTADO.**

**Objetivo de negócio (verbatim do pedido):** em hipótese alguma o Kyneti pode enviar ao marketplace um preço abaixo do valor mínimo estabelecido pelo fornecedor/marca para um produto — a Política de Preço Mínimo Anunciado (MAP, do inglês *Minimum Advertised Price*).

## 0. Correção de premissa (antes de qualquer código)

O pedido original assumia "registrar no nosso sistema de auditoria existente". Uma varredura no código (`ErpSyncChangeEvent`, `MarketplaceChangeEvent`, `StockMovementAuditEvent`) confirmou que nenhum desses mecanismos serve para "quem mudou o campo X do Product, quando, de/para qual valor" — cada um audita um domínio de evento diferente (sync de ERP, mudança de anúncio, movimentação de estoque). Não existia, antes desta política, um sistema genérico de "trilha de auditoria de campo de entidade". A resposta não foi ignorar a lacuna nem construir um sistema de auditoria genérico para qualquer entidade/campo (over-engineering não pedido) — foi construir `ProductAuditLog`, deliberadamente escopado a campos de **governança** do `Product` (hoje só `mapPrice`), com um campo `field: String` livre para acomodar futuros campos de governança sem nova migração, mas sem pretender ser um audit log universal do sistema.

## 1. Banco de dados

`Product.mapPrice Decimal? @db.Decimal(12, 2)` — nullable. `null` = sem restrição MAP para aquele SKU (comportamento hoje, antes desta política existir, é preservado para todo produto sem MAP configurado). Não é um campo espelhado do ERP (`ERP_OWNED_FIELDS` não inclui `mapPrice`) — é editável manualmente em qualquer `sourceSystem`, porque é política comercial do Precifica/fornecedor, não dado físico do produto.

```prisma
model Product {
  // ...
  mapPrice Decimal? @db.Decimal(12, 2)
}

enum ProductAuditSource {
  MANUAL
  BULK_IMPORT
}

model ProductAuditLog {
  id              String
  tenantId        String
  productId       String
  skuCode         String
  field           String   // "mapPrice" hoje
  oldValue        String?
  newValue        String?
  source          ProductAuditSource
  changedByUserId String
  changedAt       DateTime @default(now())

  @@index([tenantId, productId, changedAt])
  @@index([tenantId, field, changedAt])
}
```

`oldValue`/`newValue` são `String?` (não `Decimal?`) — a trilha de auditoria não precisa fazer aritmética sobre valores antigos, só exibi-los; string evita reintroduzir a mesma complexidade de precisão decimal que a migração de negócio já resolveu no campo em si. Migração hand-written (`20260716160000_map_price_governance`, mesmo motivo de honestidade técnica de todas as migrações deste sandbox: sem rede para `prisma migrate dev`).

## 2. A trava — três camadas, defesa em profundidade

O pedido foi explícito: "a trava não deve ser apenas na UI". A implementação vai além disso — não é uma trava, são três, cada uma independente das outras, seguindo o mesmo padrão já estabelecido para o piso financeiro de tenant (Etapa 20):

```
DefaultPricingStrategist.calculateOptimalPrice()
  └─ Camada 1: MAP entra no Math.max(safetyFloor, financialFloor, mapPrice)
     junto com os outros dois pisos já existentes — vence empate de propósito
     (furar MAP é contratual/legal, não só margem interna).
        │
        ▼
PricingDecisionService.resolveDecision()
  └─ Camada 2: recheck INDEPENDENTE usando product.mapPrice direto (não o que
     o strategist devolveu) — protege contra um PricingStrategist customizado
     futuro que não implemente o piso de MAP corretamente.
        │
        ▼
PricingDecisionService.dispatchDecision()
  └─ Camada 3 (GATE FINAL): validatePriceAgainstMap() imediatamente antes de
     priceUpdateDispatcher.dispatch() — o único funil de escrita, usado tanto
     por applyDecision() (manual) quanto decideAndMaybeApply() (automático).
     Em condições normais NUNCA dispara — é o assert de "isso não pode
     escapar", não um caminho de negócio esperado. Lança MapPriceViolationError,
     capturada e convertida em {applied: false, reason} — nunca um 500
     não tratado, mas logada em ERROR (é uma anomalia).
```

`validatePriceAgainstMap(skuCode, price, mapPrice)` é uma função pura de domínio (`domain/pricing-strategist.ts`), reaproveitada nas três camadas de teste. As camadas 1 e 2 **corrigem** silenciosamente o preço para o MAP (mesmo comportamento dos outros dois pisos); a camada 3 é a única que **lança exceção** — porque naquele ponto o preço já deveria estar correto, e se não está, é um bug, não uma decisão de negócio a corrigir.

## 3. Auditoria

`ProductAuditLogService.record(tenantId, entries, actor)` é chamado de um único lugar: `ProductsService.update()`, DEPOIS que o update persiste com sucesso (nunca antes — um registro de auditoria não pode descrever uma mudança que na verdade falhou, ex. violação de unique constraint). `diffGovernanceFields(current, input)` (função pura) compara o valor **atual persistido** contra o **input recebido**, não por presença de chave: `undefined` = campo não tocado (PATCH parcial), `null` explícito = "limpar o MAP" (uma mudança real, se o valor anterior não era `null`). Reenviar o mesmo valor não gera um registro de auditoria vazio.

`ProductUpdateActor { userId: string; source?: ProductAuditSource }` — obrigatório em `ProductsService.update()`: toda alteração de campo de governança precisa de um autor identificável. `source` default `'MANUAL'` (PATCH `/products/:id`); `BulkMapPriceImportService` passa `'BULK_IMPORT'` explicitamente.

Endpoint de leitura: `GET /products/:id/audit-log` (ADMIN only).

## 4. Importação em massa via planilha

`POST /products/bulk-import/map-price` (ADMIN only), corpo `{ fileContent: string }` — CSV cru (`sku_code,map_price`), não multipart/form-data. Este projeto evita `FileInterceptor`/multipart em todo o código (confirmado por varredura — até upload de chunk de vídeo do Pick & Pack usa base64 em JSON, ver comentário em `main.ts`); a importação de MAP segue a mesma convenção: o frontend lê o arquivo local (`input[type=file]` + `FileReader`) e manda o texto no corpo. Limite de corpo JSON já é 15mb (`app.useBodyParser('json', { limit: '15mb' })`), suficiente.

`parseMapPriceImportCsv` (função pura, `domain/map-price-import-row-parser.ts`) nunca lança — erros de linha são coletados e devolvidos juntos, para o usuário corrigir tudo de uma vez, não uma linha por tentativa. Célula `map_price` vazia = `null` = "limpar o MAP daquele SKU" (mesma semântica de `diffGovernanceFields`). **Limitação documentada:** parsing por `split(',')` ingênuo, sem suporte a campos entre aspas — mesma limitação já aceita em `GenericSettlementParser` (Financial Intelligence); não há parsing de `.xlsx` binário (exigiria a dependência `xlsx`, não presente hoje — trocar depois é isolado a este arquivo).

`BulkMapPriceImportService.importFromCsv(tenantId, fileContent, actor)`:

1. Parseia o CSV. Se **qualquer** linha tiver erro de formato → **política tudo-ou-nada**: nada é aplicado.
2. Busca os produtos ativos do tenant, valida que todo `sku_code` do CSV existe. Se **qualquer** SKU não existir → tudo-ou-nada de novo: nada é aplicado.
3. Só então, para cada linha válida com mudança real (`row.mapPrice !== product.mapPrice`), chama `ProductsService.update(tenantId, product.id, { mapPrice: row.mapPrice }, { userId: actor.userId, source: 'BULK_IMPORT' })` — o **mesmo método** que o PATCH manual usa. Garante estruturalmente que a importação em massa nunca pode gravar um `mapPrice` sem passar pela mesma trilha de auditoria do caminho manual: não existe um segundo caminho de escrita que a esqueça.

**Por que tudo-ou-nada, não parcial (decisão deliberada, não a única possível):** um import parcial deixaria o catálogo num estado "alguns SKUs já com a política nova, outros não, sem o operador saber quais sem investigar" — pior para uma política de PREÇO MÍNIMO (onde o erro custa dinheiro ou viola contrato com o fornecedor) do que obrigar a corrigir a planilha e reimportar do zero.

## 5. Testes (Jest, mesma disciplina da Fase 4)

| Arquivo | Cobertura |
|---|---|
| `default-pricing-strategist.spec.ts` (novo describe) | MAP mais restritivo vence; MAP mais frouxo não é acionado; MAP empata com piso financeiro e vence (contratual > margem interna); `mapPrice: null` não influencia; `mapPrice <= 0` rejeitado. |
| `pricing-decision.service.spec.ts` (novo describe) | recheck de camada 2 corrige decisão de um strategist "que esqueceu o MAP"; `applyDecision` aplica o preço já corrigido; `mapPrice: null` não altera nada; gate final (camada 3) bloqueia o dispatcher mesmo com uma decisão que "escapou" das duas camadas anteriores (chamada direta a `dispatchDecision`, contornando `resolveDecision`, para provar que o gate funciona por si só). |
| `product-audit.spec.ts` (novo) | `diffGovernanceFields` — `undefined` vs `null` explícito, reenvio do mesmo valor, primeira atribuição de MAP. |
| `product-audit-log.service.spec.ts` (novo) | serialização número→string preservando `null`, uma entrada por item, lista vazia não chama o repositório. |
| `map-price-import-row-parser.spec.ts` (novo) | linhas válidas, célula vazia = limpar MAP, cabeçalho case-insensitive, `sku_code` vazio, `map_price` não numérico ou ≤0, cabeçalho inválido, arquivo vazio, linhas em branco ignoradas, múltiplos erros coletados juntos. |
| `bulk-map-price-import.service.spec.ts` (novo) | happy path (2 SKUs), linha sem mudança real (`unchanged`), tudo-ou-nada em erro de parsing, tudo-ou-nada em SKU inexistente, limpar MAP via célula vazia, escopo por tenant. |

Fixtures pré-existentes que quebraram por causa dos novos campos obrigatórios (`PricingContext.mapPrice`, `PricingDecision.{mapPrice,hitMapFloor}`, `ProductCatalogSummary.mapPrice`, `Product.mapPrice`, `ProductsService.update()` ganhando o 4º parâmetro `actor`) foram corrigidas em `promotion-intelligence.service.spec.ts`, `order-sync-orchestrator.service.spec.ts`, `orders.service.spec.ts`, `logistics-cost-reader.service.spec.ts`, `catalog-reader.service.spec.ts` e `products.service.spec.ts` — mesma classe de mudança que `targetRoas` foi para `FinancialPolicy` na Fase 4.

**Limitação de sandbox, honestamente documentada (não nova, já existia antes do MAP):** `products.service.spec.ts` e `bulk-map-price-import.service.spec.ts` importam `ProductsService`, que importa `Prisma` de `@prisma/client` para `translateError` (checagem de `P2002`) — o client Prisma não é gerado neste sandbox (rede bloqueada para baixar os binários de engine). `ts-jest` falha ao compilar esses dois arquivos de teste por essa razão, não por erro de lógica — confirmado via `tsc --noEmit`, que mostra os mesmos 241 erros de baseline (`Property 'X' does not exist on type 'PrismaService'`, `class-validator` sem `.d.ts`, `S3Client.send`) espalhados por **todo** módulo do projeto que toca Prisma, não algo introduzido pelo MAP. As demais 10 suítes de teste do MAP e dos módulos afetados (92 testes) rodam e passam neste sandbox.

## 6. Resumo dos três pedidos do usuário

1. **Schema + migração:** `Product.mapPrice` (Decimal, nullable) + `ProductAuditLog` (novo modelo) — seção 1.
2. **`validatePriceAgainstMap` chamado antes de `applyAction`/`updatePrice`:** implementado como gate final na camada 3, mais duas camadas adicionais de defesa em profundidade antes dela — seção 2.
3. **Importação em massa com auditoria de quem alterou:** CSV via texto em JSON (convenção do projeto), política tudo-ou-nada, reaproveitando o mesmo funil de auditoria do caminho manual — seção 4.
