# Ordens de Produção — BOM real (Projeto Estruturante 1, benchmark Bling ERP)

Implementado em 29/07/2026, a partir de `docs/bling-erp-benchmark-analysis.md`, seção 1.1 — o gap mais crítico identificado no benchmark contra o Bling ERP: até esta correção, o Kyneti só tinha `Product.isKit` (Sprint 26, puramente decorativo — herda embalagem/margem, nunca baixa estoque de verdade). Qualquer seller que monta kit/combo vendia um produto cujo saldo de estoque estava desconectado da realidade.

## 1. Escopo desta rodada (decisão deliberada)

O Bling modela dois comportamentos além da composição em si: `tipoEstoque` (o kit tem saldo próprio F/físico ou é sempre calculado a partir dos componentes V/virtual) e `lancamentoEstoque` (a VENDA do kit baixa Produto e Componente, só Componente, ou só Produto). Replicar isso significaria alterar o fluxo de checkout existente (`RETAIL_SHIPMENT`, Hub de Provas) para expandir dinamicamente um SKU de kit em N SKUs de componente no momento da venda — uma mudança de risco alto num fluxo já em produção, sem demanda confirmada do usuário para esse comportamento específico.

**Decisão**: esta rodada entrega BOM (a composição) + Ordens de Produção (um processo explícito que CONVERTE componentes em estoque do produto acabado, ANTES da venda). O kit resultante é um produto normal, com saldo próprio, vendido pelo fluxo `RETAIL_SHIPMENT` existente sem nenhuma alteração. Isso é, na prática, equivalente ao modo `lancamentoEstoque = P` (só produto) do Bling — e está mais alinhado à filosofia "ação explícita, nunca automática" (Safety Lock) que o próprio benchmark elogiou no Kyneti (seção 2.3) do que uma expansão automática no momento da venda seria.

**Gap conhecido, documentado, não escondido**: não existe ainda o modo "venda do kit baixa os componentes diretamente" (`lancamentoEstoque = A/M` do Bling). Se isso vier a ser necessário, é uma extensão futura do listener de `RETAIL_SHIPMENT`, não deste módulo.

## 2. BOM real — `ProductStructureComponent` (schema `catalog`)

Atributo do produto kit (`Product.isKit = true`), mesmo racional de `Packaging`: um cadastro em `catalog`, consumido por outro módulo. Uma linha por `(tenantId, parentSkuCode, componentSkuCode)` — `quantity` é `Decimal(12,3)` (aceita componente fracionário, ex.: 0,5kg de um insumo a granel por unidade produzida).

`ProductStructureService` (CRUD): `setComponents` substitui a estrutura inteira (semântica de PUT idempotente — apaga tudo e recria, nunca faz merge parcial), validando que o produto pai existe, é `isKit = true`, e que a lista de componentes é válida (`domain/product-structure.ts`, `isValidComponents`: sem componente vazio/duplicado/quantidade não positiva, e o produto nunca pode compor a si mesmo). Endpoints: `GET/PATCH /products/:id/structure` (`:id` é o produto PAI).

Exposto a outros módulos via `PRODUCT_STRUCTURE_READER` (shared/contracts) — `getComponents(tenantId, parentSkuCode)` — consumido pelo módulo `production` sem depender da tabela nem da classe concreta.

## 3. Ordens de Produção — schema Postgres próprio (`production`)

Bounded context PRÓPRIO (mesmo racional de `procurement`): "produzir" é um processo distinto de cadastrar produto ou mover estoque, com workflow próprio.

`ProductionOrderStatus`: `RASCUNHO` (criado, componentes resolvidos via snapshot da BOM — nada de estoque ainda) → `EM_ANDAMENTO` (uso operacional/informativo) → `CONCLUIDA` (TERMINAL, já moveu estoque) ou `CANCELADA` (TERMINAL, nunca moveu estoque). Gates puros em `domain/production-order.entity.ts` (`canStart`/`canConclude`/`canCancel`) — nunca cancela depois de `CONCLUIDA`, mesmo racional de `PurchaseOrder.canCancel` bloqueando após `ATENDIDO`.

`ProductionOrder.components` (`ProductionOrderComponent`) é um **snapshot** da BOM resolvida no momento da criação (`quantityPerUnit` + `totalQuantity = quantityPerUnit × quantity`) — mesmo racional de `StockMovementAuditEventItem.expectedQuantity`/`OrderItem.costPriceUsed`: se a BOM mudar depois, uma ordem já criada não é afetada.

`ProductionOrderService.create` valida: quantidade inteira positiva; produto pai existe e é kit (via `PRODUCT_CATALOG_READER`); os dois depósitos (origem dos componentes, destino do produto acabado — podem ser o mesmo) pertencem ao tenant (via `WAREHOUSE_REPOSITORY`); e que a BOM não está vazia (via `PRODUCT_STRUCTURE_READER`) — rejeita com `BadRequestException` explicando o que falta, nunca inventa uma estrutura.

## 4. Conclusão — extensão do Hub de Provas (`PRODUCTION_OUTPUT`)

Ao concluir (`POST .../concluir`), `ProductionOrderService.conclude` chama `PRODUCTION_STOCK_WRITER.produceOutput` (shared/contracts, implementado por `StockMovementAuditEventService`) — cria E aprova um `StockMovementAuditEvent` tipo `PRODUCTION_OUTPUT` no MESMO passo, debitando cada componente (snapshot) no depósito de origem e creditando o produto acabado no depósito de destino, tudo com o mesmo `auditEventId` (mesma regra de ouro estrutural: `StockLedgerEntry.auditEventId` é sempre `NOT NULL`).

**Prova de autorização**: diferente de `RETAIL_SHIPMENT`/`FULL_DISPATCH` (mídia/vídeo obrigatórios) e de `PURCHASE_RECEIPT` (NF do fornecedor obrigatória), aqui a prova é a própria `ProductionOrder` já confirmada explicitamente pelo usuário (`canApproveProduction` só exige `conferenceStatus = PENDENTE`) — não existe uma NF nem uma verificação visual externa possível para um processo 100% interno de conversão de estoque.

`buildProductionLedgerEntries` (domain) é uma função nova, não reaproveita `buildLedgerEntries` (que assume o MESMO SKU nos dois lados, ex.: transferência Full) nem `buildPurchaseReceiptLedgerEntries` (só crédito): aqui são N SKUs debitados (componentes) e 1 SKU creditado (produto acabado), possivelmente em depósitos diferentes.

Nunca marca `CONCLUIDA` se o movimento de estoque falhar — a exceção propaga antes.

## 5. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/products/:id/structure` | Lista os componentes da BOM do produto pai |
| `PATCH` | `/products/:id/structure` | Substitui a estrutura inteira (idempotente) |
| `POST` | `/production/orders` | Cria a ordem (snapshot da BOM resolvido aqui) |
| `GET` | `/production/orders` | Lista as ordens do tenant (`?status=`) |
| `GET` | `/production/orders/:id` | Detalhe de uma ordem |
| `PATCH` | `/production/orders/:id/iniciar` | RASCUNHO -> EM_ANDAMENTO |
| `PATCH` | `/production/orders/:id/concluir` | Debita componentes + credita produto acabado, marca CONCLUIDA |
| `PATCH` | `/production/orders/:id/cancelar` | Cancela (só antes de CONCLUIDA) |

## 6. Aplicação manual pendente (schema novo + RLS)

Schema Postgres `production` é novo — precisa, além da migração normal (`prisma/migrations/20260729180000_add_production_and_bom`), dos dois passos manuais de sempre (mesmo racional de `procurement`/`fiscal`):

```
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_grant_app_runtime_production.sql
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_production_rls_only.sql
```

`catalog.product_structure_components` é tabela nova num schema já existente — não precisa de grant separado (coberto pelo `ALTER DEFAULT PRIVILEGES` de `catalog` desde a criação do role `app_runtime`), só da policy (incluída no segundo arquivo acima).

## 7. O que falta (gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- Modo "venda do kit baixa componentes diretamente" (seção 1) — deliberadamente fora do escopo desta rodada.
- BOM multinível (um componente que é, ele mesmo, um kit com sua própria estrutura) não é validado nem suportado — só o ciclo trivial de 1 nível (kit compondo a si mesmo) é bloqueado.
- Sem reserva de componentes: nada impede duas ordens de produção concorrentes de "prometerem" o mesmo saldo de componente antes de qualquer uma concluir — a validação de saldo suficiente do componente não existe ainda (a ordem sempre é aceita; se o saldo ficar negativo, isso aparece no ledger, mas não é bloqueado na criação nem na conclusão).
