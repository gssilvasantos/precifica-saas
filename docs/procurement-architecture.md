# Procurement — Ordem de Compra (Fase 1, benchmark Tiny ERP)

Implementado em 28/07/2026, a partir de `docs/tiny-erp-benchmark-analysis.md`, seção 1.3. Fecha o ciclo do `ReplenishmentAdvisorService` (Logistics Fulfillment): o painel de abastecimento **sugere** reposição, mas até aqui o lojista comprava fora do sistema, sem rastro nenhum. A Ordem de Compra registra a decisão de comprar e, ao confirmar o recebimento, credita estoque e lança a conta a pagar do fornecedor automaticamente — sem intervenção manual em dois módulos separados.

## 1. Por que um schema Postgres próprio

`procurement` é um bounded context novo (não reaproveita `logistics_fulfillment` nem `financial_intelligence`): o processo modelado aqui é o de **comprar** — negociar com um fornecedor, acompanhar a situação do pedido, confirmar o recebimento — que é conceitualmente diferente tanto do processo de **mover estoque** (Hub de Provas) quanto do de **contas financeiras** (Financial Intelligence), ainda que dispare os dois como consequência. Mesmo racional de `tagging`/`procurement` serem os primeiros schemas depois da fundação: quando o conceito de negócio é genuinamente novo, ganha uma tabela e um schema próprios, em vez de forçar encaixe em um bounded context existente.

Como qualquer schema novo, precisou de dois artefatos manuais que os schemas antigos já tinham: uma seção no arquivo mestre de RLS (`prisma/manual-migrations/2026-07-17_enable_row_level_security.sql`, aplicada via arquivo escopado `2026-07-28_apply_procurement_rls_only.sql`) e um grant explícito para o role `app_runtime` (`2026-07-28_grant_app_runtime_procurement.sql`) — sem isso, a API em produção (que roda sob `app_runtime`, sem `BYPASSRLS`) não consegue ler/escrever nada no schema novo.

## 2. Modelo de dados

```
PurchaseOrder
  id, tenantId, status (ABERTO|ANDAMENTO|ATENDIDO|CANCELADO)
  supplierId    -- referência SOLTA a catalog.Supplier (schema diferente)
  warehouseId   -- referência SOLTA a logistics_fulfillment.Warehouse (destino do recebimento)
  paymentDueDate, notes
  invoiceNumber, receivedAt   -- preenchidos só por receive(), nunca em create()
  items: PurchaseOrderItem[]

PurchaseOrderItem
  id, tenantId (denormalizado — RLS precisa filtrar a tabela diretamente)
  purchaseOrderId -> PurchaseOrder (FK real, mesmo schema, onDelete: Cascade)
  skuCode          -- referência SOLTA a catalog.Product
  quantity, unitCost, ipi (opcional)
```

`supplierId`/`warehouseId`/`skuCode` são referências soltas (String, sem FK) porque o Prisma `multiSchema` não modela `@relation` cross-schema — o mesmo padrão já usado em `AccountsPayable.supplierId`, `TagAssignment.entityId`, `StockLedgerEntry.skuCode`. A validação de posse (o registro referenciado pertence a este tenant) acontece na camada de aplicação, via os repositórios injetados dos módulos donos.

`PurchaseOrderItem.tenantId` é denormalizado mesmo já existindo uma FK real para `PurchaseOrder` — necessário porque as policies de RLS filtram cada tabela diretamente, nunca via JOIN (mesmo padrão de `StockMovementAuditEventItem`).

## 3. Máquina de estados

```
ABERTO --advance()--> ANDAMENTO --receive()--> ATENDIDO (terminal)
ABERTO -----------------------------receive()--> ATENDIDO (terminal)
ABERTO/ANDAMENTO --cancel()--> CANCELADO (terminal)
```

`ATENDIDO` é sempre terminal — uma vez recebida, a ordem já creditou estoque e gerou conta a pagar; cancelar depois disso deixaria o sistema inconsistente (mesmo racional de `AccountsPayableService.cancel` bloqueando quando já `PAID`). `cancel()` a partir de `CANCELADO` é idempotente (não chama o repositório de novo). As transições são decididas por funções puras (`canAdvance`/`canReceive`/`canCancel`, `domain/purchase-order.entity.ts`) — mesmo padrão de `GateCheck` já usado no Hub de Provas.

## 4. Recebimento — a ação combinada

`POST /procurement/purchase-orders/:id/receber` é o equivalente combinado das duas rotas do Tiny (`lancar-estoque` + `lancar-contas`): uma única chamada de negócio, duas integrações cross-módulo, sempre por porta exportada — nunca importando a classe concreta de outro módulo.

```
PurchaseOrderService.receive(tenantId, id, invoiceNumber, conferredByUserId)
  1. valida a NF e o gate de transição (canReceive)
  2. StockReceiptWriter.receivePurchase(...)          -- credita estoque (Hub de Provas)
  3. AccountsPayableWriter.createSingle(...)           -- lança a conta a pagar
  4. PurchaseOrderRepository.markReceived(...)          -- ATENDIDO + invoiceNumber + receivedAt
```

A ordem importa: se o crédito de estoque falhar, a exceção propaga antes de qualquer chamada à conta a pagar; se ela falhar depois, a ordem nunca é marcada `ATENDIDO` sem as duas pontas confirmadas. Não há uma transação distribuída cobrindo os três passos (cada porta grava no seu próprio schema) — o risco residual (estoque creditado mas conta a pagar falhou) é aceito no MVP pelo mesmo motivo de outras integrações cross-módulo desta base: o volume de ordens de compra é baixo o suficiente para uma falha nesse ponto ser corrigida manualmente, e o alternativa (saga/outbox) é complexidade desproporcional ao risco real hoje.

### 4.1 Hub de Provas — tipo `PURCHASE_RECEIPT`

O Hub de Provas (`StockMovementAuditEvent`) ganhou um terceiro tipo de evento, o único de **entrada** (crédito) — os outros dois (`FULL_DISPATCH`, `RETAIL_SHIPMENT`) são sempre saída (débito). A "prova" que autoriza a aprovação é o número da Nota Fiscal do fornecedor (`invoiceNumber`), nunca mídia/vídeo: o risco que a mídia mitiga numa saída (mercadoria saindo do depósito sem verificação física independente) não existe numa entrada — quem recebe já está de posse da NF como comprovante externo. `canApprovePurchaseReceipt`/`buildPurchaseReceiptLedgerEntries` (`logistics-fulfillment/domain/stock-movement-audit-event.entity.ts`) reaproveitam o campo `sourceWarehouseId` com semântica invertida (aqui é o depósito **creditado**, não debitado) para evitar uma migração de schema só para este caso. `StockMovementAuditEventService.receivePurchase` cria e aprova o evento no mesmo método — diferente do fluxo de despacho (criação e aprovação separadas no tempo pela conferência física), aqui a "conferência" é o próprio ato de receber a mercadoria com a NF em mãos.

### 4.2 Conta a pagar gerada

`AccountsPayableWriter.createSingle` sempre cria uma conta `UNICA` — parcelamento é uma decisão de UI/negócio tomada no cadastro direto de Contas a Pagar, nunca algo que um consumidor cross-módulo deveria escolher por conta própria. O valor vem de `computeTotalAmount` (função pura, `domain/purchase-order.entity.ts`): soma `quantity * unitCost + ipi` (quando informado) de cada item, trabalhando em centavos para nunca acumular erro de ponto flutuante — mesmo racional de `buildInstallmentAmounts` (`accounts-payable.entity.ts`). `dueDate` vem de `PurchaseOrder.paymentDueDate` (a condição comercial acordada no momento da compra, não derivada de `Supplier.paymentTerms`, que é texto livre no MVP e não parseável em data).

## 5. Portas cross-módulo

| Porta | Exportada por | Consumida por | Racional |
|---|---|---|---|
| `SUPPLIER_REPOSITORY` | Catalog | Procurement, Financial Intelligence | Valida que `supplierId` pertence ao tenant |
| `WAREHOUSE_REPOSITORY` | Logistics Fulfillment | Procurement | Valida que `warehouseId` pertence ao tenant |
| `STOCK_RECEIPT_WRITER` | Logistics Fulfillment | Procurement | Credita estoque ao receber (`receivePurchase`) |
| `ACCOUNTS_PAYABLE_WRITER` | Financial Intelligence | Procurement | Lança a conta a pagar do fornecedor ao receber (`createSingle`) |

`StockReceiptWriter`/`AccountsPayableWriter` são DTOs autocontidos em `shared/contracts/` — nenhum tipo do domínio interno de `logistics-fulfillment`/`financial-intelligence` vaza para o consumidor, mesma disciplina de `OrderFinancialsReader`/`OrderFinancialLine`.

Sem risco de dependência circular: `ProcurementModule` importa `CatalogModule`, `LogisticsFulfillmentModule` e `FinancialIntelligenceModule`; nenhum dos três importa `ProcurementModule` de volta.

## 6. Endpoints

| Método | Rota | Papel exigido |
|---|---|---|
| `POST` | `/procurement/purchase-orders` | ADMIN/PRICING_EDITOR |
| `GET` | `/procurement/purchase-orders` (filtros: `status`, `supplierId`) | qualquer autenticado |
| `GET` | `/procurement/purchase-orders/:id` | qualquer autenticado |
| `PATCH` | `/procurement/purchase-orders/:id/avancar` | ADMIN/PRICING_EDITOR |
| `PATCH` | `/procurement/purchase-orders/:id/cancelar` | ADMIN/PRICING_EDITOR |
| `POST` | `/procurement/purchase-orders/:id/receber` | ADMIN/PRICING_EDITOR |

## 7. O que falta (MVP, gaps conhecidos)

- Sem UI ainda no frontend — só a API. A tela fica para um sprint de UI dedicado, mesmo padrão de Contas a Pagar (backend primeiro).
- Sem consistência transacional entre os três passos de `receive()` (ver seção 4) — risco aceito para o volume esperado.
- `PurchaseOrderItem.ipi` é o único imposto modelado por item (espelha o campo `ipi` do Tiny) — outros impostos por item ficam para quando (se) a Fase 3 (NF-e) exigir mais granularidade fiscal na compra.
