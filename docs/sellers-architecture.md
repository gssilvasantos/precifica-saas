# Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP)

Implementado em 29/07/2026, a partir de `docs/bling-erp-benchmark-analysis.md`, seção 1.3. Antes desta rodada o Kyneti não tinha nenhuma noção de vendedor interno nem comissão — todo pedido chegava só com o comprador do marketplace, sem forma de atribuir a venda a um vendedor da loja nem de calcular/pagar comissão.

## 1. Escopo desta rodada (decisão deliberada)

O Bling modela comissão como um percentual configurável por vendedor, aplicado sobre o valor do item vendido, com relatório de fechamento por período. Reproduzir o motor de comissão inteiro (faixas progressivas, comissão por categoria de produto, split entre múltiplos vendedores no mesmo pedido) seria complexidade sem demanda confirmada.

**Decisão**: esta rodada entrega o cadastro do vendedor (com alíquota de comissão fixa), a atribuição manual explícita de um vendedor a um item de pedido já existente (nunca automática no momento do sync), o cálculo por snapshot (a comissão do item é congelada no momento da atribuição — mudar a alíquota do vendedor depois nunca recalcula item já atribuído), o relatório de comissões por vendedor/período, e a geração explícita de uma conta a pagar (repasse) somando as comissões pendentes. Mesma filosofia "ação explícita, nunca automática" (Safety Lock) usada em BOM+Ordens de Produção (Projeto Estruturante 1) e Produtos-Lotes (Projeto Estruturante 2).

**Gap conhecido, documentado, não escondido**: um pedido só pode ter UM vendedor por item (sem split de comissão entre vendedores no mesmo item); a atribuição é sempre manual, não há regra automática de território/vendedor-padrão; `descontoMaximoPct` é um campo informativo hoje, sem gate que bloqueie desconto acima do limite em nenhum fluxo de venda existente.

## 2. Cadastro do vendedor — `Vendedor` (schema novo `sellers`)

Bounded context próprio, schema Postgres novo (`sellers`) — mesmo racional de `production`/`procurement`/`fiscal`: entidade nova, sem overlap de tabela com nenhum módulo existente.

Campos: `name`, `email` (opcional), `aliquotaComissaoPct` (`Decimal(5,2)`, obrigatório), `descontoMaximoPct` (`Decimal(5,2)`, opcional, informativo — ver gaps), `isActive` (default `true`).

`VendedorService` (CRUD): `create`/`update`/`list`/`findOne`/`setActive`. `setActive(false)` é a forma de "desligar" um vendedor sem apagar o histórico de comissões já geradas (nunca DELETE). `assignVendedor` (ver seção 4) rejeita vendedor inativo. Endpoints: `POST/GET /sellers/vendedores` (+ `GET/PATCH :id`), `PATCH :id/active`.

Exposto a outros módulos via `SELLER_READER` (shared/contracts) — `findById(tenantId, vendedorId)` devolve `SellerSummary` (DTO estreito: id/name/isActive/aliquotaComissaoPct, nunca o tipo completo `Vendedor`). Hoje sem consumidor cross-módulo real (o único lookup de vendedor é intra-módulo, `CommissionService` injetando `VendedorService` direto) — mantido pelo mesmo racional de `PRODUCT_STRUCTURE_READER`/`PRODUCT_LOT_READER`: se um módulo futuro precisar resolver vendedor por id sem conhecer Sellers, a porta já existe.

## 3. Cálculo de comissão — `domain/vendedor.entity.ts`

`computeCommission(base, aliquotaPct)`: função pura, `round2(base * aliquotaPct / 100)` — arredondamento sempre para 2 casas decimais, mesmo padrão de `dre-report.ts`/`margin-calculator.ts`.

`isValidVendedorData`: `aliquotaComissaoPct` precisa estar em `[0, 100]`; `descontoMaximoPct`, quando informado, também.

## 4. Atribuição manual + snapshot — `OrderItem`

`OrderItem` ganhou 4 colunas novas (nullable): `vendedorId`, `comissaoAliquotaPct`, `comissaoValor`, `comissaoPagaEm`. Mesmo padrão de **snapshot** já usado em `OrderItem.costPrice` (Etapa 19) e `ProductionOrderComponent` (BOM, Projeto Estruturante 1): a comissão é calculada e gravada no momento da atribuição, usando a alíquota do vendedor NAQUELE instante — se `Vendedor.aliquotaComissaoPct` mudar depois, os itens já atribuídos nunca recalculam.

`CommissionService.assignVendedor(tenantId, orderId, itemId, vendedorId)`: busca o vendedor (rejeita se inativo), busca o item via `ORDER_COMMISSION_WRITER.findItemForCommission` (ver seção 5), calcula `comissaoValor = computeCommission(item.totalPrice, vendedor.aliquotaComissaoPct)`, grava via `assignVendedorToItem`. Sempre uma ação explícita (endpoint `POST`), nunca disparada pelo `OrderSyncOrchestrator`.

Endpoint: `POST /sellers/vendedores/:vendedorId/atribuir-item` (`orderId`, `itemId` no corpo).

## 5. Cross-module: por que `CommissionService` mora em `sellers`, não em `orders`

Risco de dependência circular identificado e evitado antes de qualquer código rodar: `FinancialIntelligenceModule` já importa `OrdersModule` (para `ORDER_FINANCIALS_READER`, usado pelo DRE). `CommissionService` precisa de duas coisas de módulos diferentes — o item do pedido (`OrdersModule`) e `ACCOUNTS_PAYABLE_WRITER` (`FinancialIntelligenceModule`, para gerar o repasse). Se `CommissionService` morasse em `OrdersModule`, este teria que importar `FinancialIntelligenceModule` de volta, fechando o ciclo `Orders -> Financial -> Orders` — proibido pelo NestJS.

**Resolução**: `CommissionService` mora em `SellersModule`, que importa `OrdersModule` E `FinancialIntelligenceModule` — nenhum dos dois importa `Sellers` de volta, o grafo continua um DAG acíclico. A comunicação com `Orders` acontece por uma porta nova e estreita, `ORDER_COMMISSION_WRITER` (`shared/contracts/order-commission-writer.port.ts`), implementada por `OrdersService` e exportada por `OrdersModule` — nunca a tabela `order_items` nem a classe concreta cruzam a fronteira do módulo. `CommissionLineDto` (do lado da porta) e `CommissionLine` (tipo interno do domínio de `orders`) são estruturalmente idênticos mas intencionalmente dois tipos separados, preservando o desacoplamento entre módulos.

## 6. Relatório + geração de conta a pagar (repasse)

`CommissionService.listCommissions(tenantId, vendedorId, dateFrom?, dateTo?)`: lista as linhas de comissão do vendedor no período, via `ORDER_COMMISSION_WRITER.findCommissionLines` — filtra por `Order.orderedAt` (não por quando a comissão foi atribuída), mesmo racional temporal do resto do relatório financeiro (`findAllForPeriod`, Etapa 20). Inclui comissões já pagas (`comissaoPagaEm != null`).

`CommissionService.generatePayout(tenantId, vendedorId, dateFrom, dateTo, dueDate)` (Safety Lock — `ADMIN` apenas, ação explícita nunca automática): busca só as comissões PENDENTES do período (`onlyPending: true`, filtra `comissaoPagaEm IS NULL`), soma o total, cria UMA `AccountsPayable` via `ACCOUNTS_PAYABLE_WRITER.createSingle` e só DEPOIS marca os itens envolvidos como pagos (`markCommissionsPaid`) — nunca marca pago antes da conta a pagar existir de fato, mesmo padrão de `PurchaseOrderService.receive()` (Ordem de Compra). Rejeita se não houver comissão pendente no período.

Endpoints: `GET /sellers/vendedores/:vendedorId/comissoes` (+ `?dateFrom=&dateTo=`), `POST /sellers/vendedores/:vendedorId/comissoes/gerar-conta-a-pagar` (`dateFrom`/`dateTo`/`dueDate` no corpo).

## 7. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/sellers/vendedores` | Cadastra um vendedor |
| `GET` | `/sellers/vendedores` | Lista vendedores do tenant |
| `GET` | `/sellers/vendedores/:id` | Detalhe de um vendedor |
| `PATCH` | `/sellers/vendedores/:id` | Atualiza dados do vendedor |
| `PATCH` | `/sellers/vendedores/:id/active` | Ativa/inativa um vendedor |
| `POST` | `/sellers/vendedores/:vendedorId/atribuir-item` | Atribui o vendedor a um item de pedido (snapshot de comissão) |
| `GET` | `/sellers/vendedores/:vendedorId/comissoes` | Relatório de comissões do vendedor no período |
| `POST` | `/sellers/vendedores/:vendedorId/comissoes/gerar-conta-a-pagar` | Gera conta a pagar somando comissões pendentes (ADMIN) |

## 8. Aplicação manual pendente (schema novo + colunas em tabela existente)

Schema `sellers` é novo — precisa de grant E RLS (mesmo racional de `production`/`procurement`/`fiscal`):

```
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_grant_app_runtime_sellers.sql
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_sellers_rls_only.sql
```

As 4 colunas novas em `orders.order_items` (`vendedorId`/`comissaoAliquotaPct`/`comissaoValor`/`comissaoPagaEm`) são colunas novas numa tabela JÁ protegida por RLS — RLS é por linha, não por coluna, então não precisam de grant nem de policy novos.

A mesma policy de `sellers.vendedores` também foi anexada ao arquivo mestre `2026-07-17_enable_row_level_security.sql` (fonte de verdade de todas as policies do projeto). Precisa rodar `npx prisma migrate deploy` ANTES (cria a tabela/colunas novas), só depois os dois scripts acima, nesta ordem — mesma ordem de aplicação usada em Ordens de Produção.

## 9. O que falta (gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- Sem split de comissão entre múltiplos vendedores no mesmo item de pedido.
- Atribuição sempre manual — sem regra automática de vendedor-padrão/território.
- `descontoMaximoPct` é só um campo informativo hoje — nenhum fluxo de venda existente valida ou bloqueia desconto acima desse limite.
- Sem faixas progressivas de comissão nem comissão diferenciada por categoria de produto.
