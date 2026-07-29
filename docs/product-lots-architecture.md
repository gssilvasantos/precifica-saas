# Produtos-Lotes — FEFO/validade (Projeto Estruturante 2, benchmark Bling ERP)

Implementado em 29/07/2026, a partir de `docs/bling-erp-benchmark-analysis.md`, seção 1.2. Antes desta rodada o Kyneti não tinha noção de lote/validade nenhuma — qualquer seller com produto perecível (alimentício, cosmético, farmacêutico) não conseguia rastrear qual unidade física vencia primeiro nem bloquear a venda de um lote vencido.

## 1. Escopo desta rodada (decisão deliberada)

O Bling modela o lote como uma dimensão do estoque em pé de igualdade com o depósito: toda movimentação carrega `lotCode`, e a baixa por venda pode ser automática por FEFO. Replicar a baixa automática significaria alterar os fluxos de venda/despacho já em produção (`RETAIL_SHIPMENT`, `FULL_DISPATCH`) para resolver e gravar lote no momento do checkout — mudança de risco alto num fluxo já rodando, sem demanda confirmada do usuário para esse comportamento específico.

**Decisão**: esta rodada entrega o cadastro do lote (validade, `diasPermitidoVenda`, status), o saldo por lote (via `StockLedgerEntry.lotCode`), a função pura de seleção FEFO (`selectLotsForConsumption`, só sugestão) e um lançamento manual explícito de ajuste de lote (`LOT_ADJUSTMENT` no Hub de Provas — Entrada/Saída/Balanço). Mesma filosofia "ação explícita, nunca automática" (Safety Lock) usada em BOM+Ordens de Produção (Projeto Estruturante 1).

**Gap conhecido, documentado, não escondido**: a venda/despacho de um produto `controlaLote=true` ainda NÃO resolve nem debita lote automaticamente — `RETAIL_SHIPMENT`/`FULL_DISPATCH`/`PURCHASE_RECEIPT`/`PRODUCTION_OUTPUT` continuam gravando `StockLedgerEntry` sem `lotCode` (coluna nullable). FEFO hoje é só uma sugestão de leitura (`GET .../fefo-suggestion`); a movimentação real do lote só acontece via o lançamento manual `LOT_ADJUSTMENT`. Se a baixa automática por FEFO no checkout vier a ser necessária, é uma extensão futura dos listeners/serviços existentes, não deste módulo.

## 2. Cadastro do lote — `ProductLot` (schema `catalog`)

Atributo do produto (`Product.controlaLote = true`, novo campo `Boolean @default(false)`), mesmo racional de `Product.isKit`: um cadastro em `catalog`, consumido por outro módulo. Uma linha por `(tenantId, skuCode, lotCode)`.

Campos: `lotCode`, `dataFabricacao` (opcional), `dataValidade` (obrigatória), `diasPermitidoVenda` (default 0), `codigoAgregacao` (opcional, rastreio adicional tipo GTIN/lote de agregação), `status` (`ATIVO`/`INATIVO`).

`ProductLotService` (CRUD): `create` valida que o produto existe e é `controlaLote=true` antes de aceitar o lote, valida os dados (`domain/product-lot.ts`, `isValidLotData`) e rejeita `lotCode` duplicado para o mesmo SKU. `updateStatus` alterna `ATIVO`/`INATIVO` (desativação manual do operador — bloqueia venda independente de data, ver seção 3). Endpoints: `GET/POST /products/:id/lots`, `PATCH /products/:id/lots/:lotCode/status`.

Exposto a outros módulos via `PRODUCT_LOT_READER` (shared/contracts) — `getLots(tenantId, skuCode)` / `findLot(tenantId, skuCode, lotCode)` — consumido pelo módulo `logistics-fulfillment` sem depender da tabela nem da classe concreta.

## 3. Regras de venda/vencimento — `domain/product-lot.ts`

`isLotExpired(lot, now)`: vencido quando `now >= dataValidade`.

`isLotSellable(lot, now)`: bloqueia a venda `diasPermitidoVenda` dias ANTES do vencimento de fato (ex.: `diasPermitidoVenda=30`, vence 10/08 → bloqueado a partir de 11/07), não só depois de vencido. `diasPermitidoVenda=0` (default) só bloqueia quando já vencido. `status=INATIVO` bloqueia sempre, independente de data.

`selectLotsForConsumption(lots, quantity, now)`: FEFO puro — ordena os lotes vendáveis (`isLotSellable`) por `dataValidade` crescente e aloca a quantidade pedida sempre do que vence primeiro, ignorando lotes vencidos/bloqueados/inativos/sem saldo. Retorna alocação parcial (`fullyAllocated=false`, `shortfall>0`) se o saldo vendável não cobrir tudo — nunca aloca além do disponível.

Todas as funções recebem `now: Date` como parâmetro explícito, nunca chamam `new Date()` internamente — mesmo padrão de `isExpiredForRetention` (`video-capture.entity.ts`), testável sem relógio real.

## 4. Saldo por lote — extensão do ledger

`StockLedgerEntry` ganhou a coluna opcional `lotCode` (nullable — só linhas geradas por `LOT_ADJUSTMENT` a preenchem, ver seção 1). `StockLedgerRepository.listBalancesByLot(tenantId, warehouseId, skuCode)` agrupa (`groupBy`) por `lotCode`, somando `quantityDelta`, e filtra `lotCode: { not: null }`.

`LotAvailabilityService` combina esse saldo com o metadado do lote (via `PRODUCT_LOT_READER`) para expor `getLotBalances` (saldo + validade + status por lote) e `suggestFefoConsumption` (chama `selectLotsForConsumption` com o saldo real). Endpoints: `GET /logistics-fulfillment/lot-stock/warehouses/:warehouseId/skus/:skuCode/balances` e `.../fefo-suggestion?quantity=`.

## 5. Extensão do Hub de Provas (`LOT_ADJUSTMENT`)

Novo `StockMovementEventType`, ao lado de `FULL_DISPATCH`/`RETAIL_SHIPMENT`/`PURCHASE_RECEIPT`/`PRODUCTION_OUTPUT` — lançamento manual avulso por lote (Entrada/Saída/Balanço), espelha `LoteLancamentoDTO.tipoLancamento` do Bling.

**Prova de autorização**: diferente de `RETAIL_SHIPMENT`/`FULL_DISPATCH` (mídia/vídeo obrigatórios) e `PURCHASE_RECEIPT` (NF obrigatória), aqui a prova é a justificativa textual (`notes`, campo novo em `StockMovementAuditEvent`) — `canApproveLotAdjustment` exige `conferenceStatus=PENDENTE` e `notes` não vazio. Mesmo racional estrutural de `canApproveProduction`: um ajuste 100% interno não tem NF nem verificação visual externa possível.

`resolveLotAdjustmentDelta`: ENTRADA/SAIDA sempre recebem `quantity` positiva — a direção vem do `movementType`, nunca do sinal informado pelo chamador. BALANCO não é um delta, é a **contagem física total** do lote naquele depósito agora; a função calcula `quantity - currentBalance`.

**Saldo do LOTE, não do SKU inteiro**: `StockMovementAuditEventService.adjustLot` resolve `currentBalance` via `listBalancesByLot` + `find(lotCode)`, nunca via `getBalance` (que somaria todos os lotes do SKU naquele depósito) — bug pego e corrigido antes de chegar a produção, com teste de regressão dedicado (`stock-movement-audit-event.service.spec.ts`, isolando dois lotes com saldos diferentes).

`buildLotAdjustmentLedgerEntry` grava sempre exatamente UMA linha de ledger (um lançamento afeta um único depósito/SKU/lote por vez), com `lotCode` preenchido e `auditEventId` sempre `NOT NULL` — mesma regra de ouro estrutural do resto do Hub de Provas.

Endpoint: `POST /logistics-fulfillment/lot-stock/adjustments` (`warehouseId`, `skuCode`, `lotCode`, `movementType`, `quantity`, `notes`).

## 6. Cross-module: `PRODUCT_LOT_READER`

Mesmo padrão de `PRODUCT_STRUCTURE_READER` (Projeto Estruturante 1): porta compartilhada em `shared/contracts`, implementada por `ProductLotService` (Catalog), consumida por `LotAvailabilityService` e `StockMovementAuditEventService.adjustLot` (Logistics Fulfillment) — nunca a tabela nem a classe concreta.

`LotAvailabilityService` também importa `selectLotsForConsumption`/`LotAvailability`/`FefoSelectionResult`/`ProductLotStatus` diretamente do domínio do Catalog (não via porta) — são funções/tipos puros, sem efeito colateral, mesmo racional de `ProductionOrderService` importando `resolveComponentRequirements` direto de `catalog/domain/product-structure`.

## 7. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/products/:id/lots` | Lista os lotes cadastrados do produto |
| `POST` | `/products/:id/lots` | Cadastra um lote (produto precisa ser `controlaLote=true`) |
| `PATCH` | `/products/:id/lots/:lotCode/status` | Ativa/inativa um lote |
| `POST` | `/logistics-fulfillment/lot-stock/adjustments` | Lançamento manual (Entrada/Saída/Balanço) |
| `GET` | `/logistics-fulfillment/lot-stock/warehouses/:warehouseId/skus/:skuCode/balances` | Saldo por lote num depósito |
| `GET` | `/logistics-fulfillment/lot-stock/warehouses/:warehouseId/skus/:skuCode/fefo-suggestion?quantity=` | Sugestão FEFO (só leitura) |

## 8. Aplicação manual pendente (tabela nova + RLS)

`catalog.product_lots` é tabela nova num schema já existente — não precisa de grant separado (coberto pelo `ALTER DEFAULT PRIVILEGES` de `catalog` desde a criação do role `app_runtime`), só da policy:

```
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_product_lots_rls_only.sql
```

A mesma policy também foi anexada ao arquivo mestre `2026-07-17_enable_row_level_security.sql` (fonte de verdade de todas as policies do projeto). Precisa rodar `npx prisma migrate deploy` ANTES (cria a tabela/colunas novas), só depois o script de RLS acima — mesma ordem de aplicação usada em Ordens de Produção.

## 9. O que falta (gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- Baixa automática de lote por FEFO nos fluxos de venda/despacho/compra/produção existentes (seção 1) — deliberadamente fora do escopo desta rodada; hoje é só sugestão de leitura.
- Sem reserva de lote: nada impede duas operações concorrentes de "prometerem" o mesmo saldo de um lote antes de qualquer uma confirmar.
- `codigoAgregacao` é só um campo de rastreio adicional — não há regra de negócio associada a ele ainda (ex.: vínculo entre lotes agregados de fornecedores diferentes).
