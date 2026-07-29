# Lista de Preços com Exceções (Fase 2, benchmark Tiny ERP)

Implementado em 28/07/2026, a partir de `docs/tiny-erp-benchmark-analysis.md`, seção 1.5. Absorve o *conceito* de tabela de preços do Tiny (`ListaPrecoResponseModel` + `ExcecaoListaPrecoModel`), sem replicar sua implementação exata.

## 1. Um único percentual com sinal, não dois campos

O Tiny modela o ajuste como `acrescimoDesconto` — sempre positivo, mais um flag separado indicando se é acréscimo ou desconto. Aqui, `PriceList.adjustmentPct` é um único `Float` com sinal: positivo = acréscimo, negativo = desconto (ex.: `-10` = "10% off"). Validado por `isValidAdjustmentPct` (`domain/price-list.entity.ts`) dentro de `(-100, 1000]` — o piso exclusivo evita que o preço resultante zere ou vire negativo; o teto é generoso porque não há necessidade de negócio real para um limite mais apertado.

## 2. FK real, não referência solta

Diferente de Ordem de Compra (`PurchaseOrder.supplierId`/`warehouseId`), que usa referências soltas porque `Supplier`/`Warehouse` vivem em schemas Postgres diferentes do `procurement`, aqui `PriceListException.productId` aponta para `Product` **dentro do mesmo schema** (`catalog`). Prisma multiSchema modela `@relation` normalmente entre modelos do mesmo schema, então usamos FK real com `onDelete: Cascade` — apagar um produto remove automaticamente suas exceções de preço, sem lixo órfão.

`tenantId` continua denormalizado em `PriceListException` mesmo com a FK real — RLS precisa filtrar cada tabela diretamente, não via JOIN, mesmo padrão de `PurchaseOrderItem`/`TagAssignment`.

## 3. Exceção sempre vence

`resolveListPrice(basePrice, adjustmentPct, exceptionOverridePrice?)` é uma função pura: se existe um `overridePrice` para aquele produto naquela lista, ele sempre vence sobre o cálculo percentual — mesmo espírito do `ExcecaoListaPrecoModel` do Tiny. `setException` é upsert por `(priceListId, productId)` — reenviar o mesmo produto com valor novo apenas atualiza, nunca duplica (garantido por `@@unique` no schema).

## 4. basePrice é sempre informado por quem chama

`PriceListService.resolvePrice(tenantId, priceListId, productId, basePrice)` recebe `basePrice` como parâmetro explícito — não consulta sozinho o motor de repricing (`PricingStrategist`/`PricingDecisionService`) nem nenhum campo de "preço atual" armazenado. Isso porque o Kyneti **não tem um preço de produto único e canônico**: o preço é sempre calculado dinamicamente por canal. Decisão deliberada para manter `PriceListService` como um calculador de leitura puro e desacoplado — mesmo racional de `resolveShippingDimensions` receber tudo explicitamente em vez de buscar sozinho.

**Gap conhecido**: sem integração automática com o motor de repricing ainda. Hoje é o chamador (frontend, ou uma integração futura) quem decide qual `basePrice` usar.

## 5. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/price-lists` | Cria lista (name + adjustmentPct) |
| `GET` | `/price-lists` | Lista as listas ativas do tenant |
| `GET` | `/price-lists/:id` | Detalhe de uma lista |
| `PATCH` | `/price-lists/:id` | Atualiza name/adjustmentPct |
| `DELETE` | `/price-lists/:id` | Desativa (soft, `isActive = false`) |
| `POST` | `/price-lists/:id/exceptions` | Cria/atualiza a exceção de um produto (upsert) |
| `GET` | `/price-lists/:id/exceptions` | Lista as exceções da lista |
| `DELETE` | `/price-lists/:id/exceptions/:productId` | Remove a exceção de um produto |
| `GET` | `/price-lists/:id/resolve-price/:productId?basePrice=X` | Aplica a lista (+ exceção, se houver) sobre `basePrice` |

## 6. O que falta (MVP, gaps conhecidos)

- Sem UI ainda no frontend — só a API, mesmo padrão do resto da Fase 2.
- Sem integração automática com o motor de repricing (ver seção 4) — `basePrice` sempre externo.
- Sem vínculo de lista de preços a canal/cliente específico — é uma lista genérica por tenant, sem segmentação ainda.
