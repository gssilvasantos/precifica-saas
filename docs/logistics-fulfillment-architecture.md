# Gestão Logística e Auditoria — Hub de Provas + Full Fulfillment (Sprint 24)

**Status:** cobre a arquitetura de dados do "Hub de Provas" pedida pelo usuário e a primeira fatia de implementação real — o gate de verificação visual obrigatória, o modelo de depósitos (físico + CDs virtuais do Full) e o primeiro consumidor de `ORDER_EVENTS.READY_FOR_FULFILLMENT`. As duas extensões explicitamente adiadas para uma próxima sprint (inteligência de abastecimento ABC/giro e a integração `custoFull` no DRE) estão descritas na seção 6 como gap honesto, não como trabalho concluído.

## 1. Por que um único "Hub de Provas" para os dois fluxos

O pedido original distinguia "Full Fulfillment" (despacho para CD de marketplace) de "Auditoria de Vendas" (envio de varejo unitário), mas propositalmente os dois nunca viram tabelas separadas. Qualquer saída de estoque — lote Full ou pedido unitário — é o mesmo conceito: um evento que precisa de prova visual antes de mexer no ledger. Tratá-los como a mesma entidade (`StockMovementAuditEvent`, campo `eventType: 'FULL_DISPATCH' | 'RETAIL_SHIPMENT'`) evita duplicar a máquina de estados, o gate de aprovação e a consulta de saldo para cada um.

## 2. Modelo de dados

```
Warehouse            — o físico (1 por tenant) e cada CD_FULL_<canal> (1 por canal), mesma entidade.
StockMovementAuditEvent — o Hub de Provas propriamente dito. 1 registro por evento de saída.
StockMovementAuditEventOrder — join N:N (1 evento pode cobrir N pedidos, ou nenhum, num reabastecimento preventivo).
StockLedgerEntry      — o movimento de estoque em si. Append-only, nunca UPDATE.
```

**Regra de ouro estrutural:** `StockLedgerEntry.auditEventId` é `NOT NULL`. Não existe, hoje, nenhum caminho de código na aplicação inteira que grave uma linha de ledger sem antes ter um `StockMovementAuditEvent` já `APROVADO` com `mediaUrl` preenchido — porque o único método capaz de construir uma `StockLedgerEntry` (`StockMovementAuditEventService.approve`) é bloqueado por uma função pura (`canApprove`) antes de chegar lá. Ver seção 3.

`StockMovementAuditEvent` carrega, por linha, exatamente os quatro vínculos pedidos: pedido(s)/envio (via `StockMovementAuditEventOrder`), mídia (`mediaUrl`/`mediaType`), status de conferência (`conferenceStatus: PENDENTE | APROVADO | DIVERGENTE`) e nota fiscal (`invoiceNumber`).

## 3. O gate de duas fases (verificação visual obrigatória)

A pergunta do pedido original — "como tornar a verificação visual obrigatória antes de finalizar o registro no banco?" — foi resolvida sem trigger de banco (ver gap honesto, seção 6), só com desenho de aplicação:

**Fase 1 — criação (`createPending`).** Cria o evento como `PENDENTE`. **Nenhum estoque se move aqui**, nem no `RETAIL_SHIPMENT` automático (disparado pelo listener, seção 4) nem no `FULL_DISPATCH` manual (disparado pelo endpoint `POST /logistics-fulfillment/audit-events`).

**Anexar mídia (`attachMedia`).** Só é aceito enquanto o evento está `PENDENTE`. Não aprova nada sozinho — só satisfaz um dos dois pré-requisitos que a fase 2 exige.

**Fase 2 — decisão.** Duas saídas possíveis, mutuamente exclusivas, cada uma delas usando `requireEvent` + uma função pura de gate antes de tocar o repositório:

- `approve(tenantId, eventId, conferredByUserId, lines)` — chama `canApprove(event)`, que só devolve `ok: true` se `conferenceStatus === 'PENDENTE'` **e** `mediaUrl` estiver preenchido. Se passar, `buildLedgerEntries` traduz as linhas (`skuCode`+`quantity`) em débito no físico (sempre) e crédito no CD de destino (só em `FULL_DISPATCH`), e `approveWithLedger` grava o novo status **e** as linhas de ledger na mesma transação Prisma — nunca em dois passos, para não existir uma janela em que um esteja consistente e o outro não.
- `markDivergent(tenantId, eventId, conferredByUserId, divergenceNotes)` — nunca grava ledger, sempre emite um alerta técnico `ERROR` via `AlertService` (mesma porta da Sprint 23): uma divergência de conferência não pode depender de alguém abrir a tela para notar.

```
PENDENTE ──attachMedia──> PENDENTE (com mídia)
PENDENTE (com mídia) ──approve──> APROVADO  [grava StockLedgerEntry, única vez possível]
PENDENTE ──markDivergent──> DIVERGENTE  [nunca grava ledger, sempre alerta]
```

Testado em `domain/stock-movement-audit-event.spec.ts` (10 casos, funções puras) e `application/stock-movement-audit-event.service.spec.ts` (9 casos, incluindo os três jeitos de tentar burlar a regra: sem mídia, sem linha nenhuma, evento já decidido).

## 4. Depósitos e o primeiro consumidor real de `ORDER_EVENTS.READY_FOR_FULFILLMENT`

`WarehouseService.ensurePhysicalWarehouse`/`ensureFullWarehouse` são idempotentes por `(tenantId, code)` — "habilitar o Full num canal" nunca é uma migration, é só garantir que o CD virtual daquele canal existe na primeira vez que for preciso.

`OrderReadyForFulfillmentListener` é o primeiro consumidor de um evento que existia desde a Etapa 16/17 documentado como "ponto de extensão, nenhum consumidor ainda". Segue exatamente o mesmo padrão de import de `ReceivableFromOrderListener` (Financial Intelligence): importa só `orders/domain/order-events.ts` (constantes/tipos), nunca `OrdersModule` nem nenhuma classe de aplicação/infra de lá — zero acoplamento circular. Ao disparar `PREPARANDO_ENVIO`, cria um `StockMovementAuditEvent` `RETAIL_SHIPMENT` `PENDENTE` no depósito físico do tenant; se o pedido já tiver um evento (reimportação sem nova transição), não duplica; se a criação falhar, nunca deixa a exceção subir — sempre emite alerta técnico `ERROR` e segue.

## 5. Interface HTTP

| Rota | Guarda | Descrição |
|---|---|---|
| `POST /logistics-fulfillment/audit-events` | ADMIN/PRICING_EDITOR | Monta um lote `FULL_DISPATCH` manual — resolve físico + `CD_FULL_<canal>` via `WarehouseService`, cria o evento `PENDENTE` |
| `GET /logistics-fulfillment/audit-events/:id` | autenticado | Consulta um evento (com `orderIds` resolvidos) |
| `POST /logistics-fulfillment/audit-events/:id/media` | ADMIN/PRICING_EDITOR | Recebe `contentBase64`+`contentType` (mesma simplificação consciente de `ImportSettlementDto` — sem multipart), persiste via `FILE_STORAGE` (adapter de disco local já existente, reexportado por `ErpIntegrationModule`) e só então grava a URL final no evento |
| `POST /logistics-fulfillment/audit-events/:id/approve` | ADMIN/PRICING_EDITOR | Fase 2 — aprova, com `lines: [{skuCode, quantity}]` |
| `POST /logistics-fulfillment/audit-events/:id/divergent` | ADMIN/PRICING_EDITOR | Fase 2 — marca divergente |
| `GET /logistics-fulfillment/warehouses` | autenticado | Lista depósitos do tenant |
| `GET /logistics-fulfillment/warehouses/:id/balances` | autenticado | Saldo por SKU (soma de `StockLedgerEntry.quantityDelta`) |

## 6. Gap honesto remanescente (ao final da Sprint 24)

Duas partes do pedido original foram **desenhadas mas não implementadas** na Sprint 24 — escopo confirmado com o usuário como a fatia inicial (Hub de Provas + modelo de depósitos):

- **Inteligência de abastecimento (curva ABC/giro):** só existia como pseudo-código apresentado na fase de design. **Fechado na Sprint 25 — ver seção 7.**
- **`custoFull` no DRE:** o `FinancialOrchestrator`/`DreReport` (Etapa 20/Sprint 23) ainda não recebe nenhum custo vindo deste módulo (comissão do Full, frete, armazenagem). A extensão prevista é aditiva — um novo campo em `DreOrderLine`/`DreChannelBreakdown`, populado pela porta `LogisticsCostReader`. **Atualização (Sprint 26): a porta `LogisticsCostReader` foi construída** (ver `docs/promotion-intelligence-architecture.md`, seção 3) e já é exportada por este módulo (`LogisticsCostReaderService`, token `LOGISTICS_COST_READER`) — mas seu único consumidor até agora é o Motor de Margem de Promoções (`promotion-intelligence`), avaliando um SKU isolado antes de qualquer pedido existir. A integração com `custoFull` no DRE (que precisaria do método `getPackagingCostForOrder`, já existente na porta mas ainda não chamado por ninguém — ver gap explícito na seção 5 do doc de Promotion Intelligence) **continua em aberto**.
- **Sem trigger de banco:** a regra de ouro é só de aplicação (o único método capaz de gravar `StockLedgerEntry` é `approve()`, gateado por `canApprove()`), não um `CHECK`/trigger no Postgres. Mesmo racional do "piso redundante" de `PricingDecisionService` em outro módulo — defesa em profundidade na camada de aplicação, não no banco. Não existe mecanismo de migration neste repositório para eu autorar SQL bruto com segurança sem interferir no `prisma migrate dev` que o usuário roda localmente.
- **Prisma Client não regenerado neste ambiente:** os repositórios Prisma deste módulo foram construídos por correspondência cuidadosa e manual com `schema.prisma` — o mesmo bloqueio de rede (`403` ao buscar engine binaries) que já impede `npx prisma generate`/`validate` neste sandbox desde etapas anteriores também afeta este módulo. `npx tsc --noEmit` já falha hoje, antes destas sprints, para todo repositório Prisma cujo model não está no client gerado localmente (`packaging`, `fixedExpense`, `mercadoLivreConnection`, etc.) — os arquivos deste módulo falham pelo mesmo motivo, não por um erro de código. Isso se resolve sozinho assim que `npx prisma migrate dev` for executado no ambiente real do usuário.

Testes da Sprint 24: `warehouse.service.spec.ts`, `stock-movement-audit-event.spec.ts` (domínio puro), `stock-movement-audit-event.service.spec.ts`, `order-ready-for-fulfillment.listener.spec.ts` — 25 no total. Os repositórios Prisma não têm teste unitário próprio, mesmo padrão de todo repositório Prisma já existente na plataforma (nenhum tem `.spec.ts` — dependem de banco real, fora do escopo de teste unitário deste projeto).

## 7. Inteligência de Abastecimento e lead time configurável (Sprint 25)

Pedido do usuário: uma tabela-resumo de decisão rápida — `SKU | Giro na Plataforma X | Saldo Atual no Full | Sugestão de Envio do Físico | Status de Abastecimento` — seguida, no meio da implementação, por um segundo pedido explícito: o lead time de reposição deixar de ser uma constante e virar configurável por depósito, com 15 dias como padrão inicial.

### 7.1 Curva ABC + sugestão — `domain/replenishment-advisor.entity.ts`

Funções puras, sem I/O:

- **`classifyAbc(inputs)`** — método de Pareto clássico: ordena os SKUs por giro (unidades vendidas na janela) desc, acumula a participação e corta em 80%/95% (A/B/C). Giro total zero classifica tudo como C (não há dado para priorizar).
- **`computeReplenishmentSuggestion({ giroDiario, saldoFull, saldoFisico, leadTimeDays, abcClass })`** — o núcleo da decisão:
  - `giroDiario <= 0` → status `SEM_GIRO`, sugestão sempre 0 (não há base para decidir).
  - Cobertura atual = `saldoFull / giroDiario` (em dias). Alvo de cobertura = `leadTimeDays + diasDeSegurançaDaClasse` (segurança: A=7, B=4, C=2 — classe A recebe buffer maior porque o custo de ruptura é desproporcionalmente mais caro).
  - `status`: `CRITICO` se a cobertura não alcança nem o lead time puro; `ATENCAO` se cobre o lead time mas não o alvo com segurança; `OK` caso contrário.
  - `sugestaoEnvio` = `min(alvo − saldoFull, saldoFisico)` arredondado para cima — **nunca sugere mais do que o físico realmente tem disponível**; se o ideal excede o físico, `physicalShortfall: true` sinaliza isso para a UI.

### 7.2 `ReplenishmentAdvisorService` — cruzando Orders com o Ledger

Reaproveita a porta **`ORDER_FINANCIALS_READER`** (Etapa 20) — a mesma que já alimenta o DRE — em vez de criar uma porta nova: `listForPeriod(tenantId, since)` já devolve `channelCode` + `items[].skuCode/quantity` por pedido, exatamente o que é preciso para agregar giro por SKU num canal, numa janela de **30 dias** (confirmado com o usuário). Pedidos `CANCELADO` são excluídos do giro — mesmo racional de reconhecimento de receita do DRE (`dre-report.ts`).

Para cada SKU (união dos que venderam no canal, dos que têm saldo no Full e dos que têm saldo no físico — um SKU parado não some da tabela, aparece como `SEM_GIRO`), o serviço busca `saldoFull`/`saldoFisico` via `StockLedgerRepository.listBalancesByWarehouse` (Sprint 24) e chama `computeReplenishmentSuggestion`. A tabela final é ordenada por urgência (`CRITICO` → `ATENCAO` → `OK` → `SEM_GIRO`, e por giro dentro do mesmo status) — o "painel de decisão rápida" pedido: o que precisa de atenção já aparece no topo.

### 7.3 Lead time configurável por depósito

Pedido intermediário do usuário, durante a implementação: o lead time (dias entre despachar do físico e o estoque ficar disponível no CD) não pode ser uma constante no código — precisa ser editável por depósito, com 15 dias como padrão. Decisão de arquitetura: **estender `Warehouse`** (`leadTimeDays Int @default(15)`) em vez de criar uma tabela `LogisticsConfiguration` separada — mesmo racional econômico de `CatalogSettings` vs. um `TenantConfig` nunca criado (Etapa 13): o lead time É uma propriedade do depósito, não um conceito à parte que precisaria de join.

- **`WarehouseRepository.updateLeadTimeDays(tenantId, warehouseId, leadTimeDays)`** — isolado do `upsert` (que só garante existência) de propósito: uma edição explícita do usuário não deveria arriscar sobrescrever outro campo num upsert genérico.
- **`WarehouseService.updateLeadTimeDays`** valida o valor (`isValidLeadTimeDays` — inteiro positivo, teto de 90 dias, sem lista fechada: a UI sugere 3/7/15 como atalhos, mas o usuário pediu controle total, não 3 opções travadas) e a posse (nunca edita depósito de outro tenant).
- **`ReplenishmentAdvisorService` lê `fullWarehouse.leadTimeDays` a cada chamada** — nunca uma constante — e devolve `leadTimeDaysUsed` em cada linha, para a UI mostrar que a tabela reage de fato à reconfiguração.
- **Endpoint:** `PATCH /logistics-fulfillment/warehouses/:id/lead-time` (ADMIN/PRICING_EDITOR), corpo `{ leadTimeDays }`.

### 7.4 Interface HTTP e frontend

- **`GET /logistics-fulfillment/replenishment?channelCode=X`** — devolve a tabela completa, qualquer papel autenticado (leitura pura, nunca escreve estoque).
- **`routes/AbastecimentoPage.tsx`** (nova, `/abastecimento`) — seletor de canal, painel de configuração do lead time (atalhos 3/7/15 dias + campo customizado) e a tabela pedida literalmente: SKU, Curva ABC, Giro na Plataforma \<canal\>, Saldo Atual no Full, Saldo no Físico, Sugestão de Envio do Físico (com aviso quando o físico é insuficiente), Status de Abastecimento (badge por severidade).

### 7.5 Gap honesto desta sprint

- `custoFull` no DRE continua em aberto (ver seção 6) — não fazia parte do pedido desta sprint.
- A classificação ABC é recalculada a cada chamada, em memória, a partir da janela de 30 dias — não é persistida nem tem histórico (não foi pedido ainda).
- O painel assume que o usuário já tem o CD Full do canal criado (via `ensureFullWarehouse`, chamado automaticamente) — não há tela separada de "habilitar Full por canal" ainda, é implícito ao consultar/editar o lead time.

Testes novos: `replenishment-advisor.spec.ts` (10, domínio puro — Pareto + as 4 combinações de status + arredondamento + teto pelo físico), `replenishment-advisor.service.spec.ts` (7, integração dos três dados + ordenação + prova de que o lead time vem do depósito configurado, não de uma constante), extensão de `warehouse.service.spec.ts` (+4, `updateLeadTimeDays`) — todos passando (`npx jest src/modules/logistics-fulfillment`, 45 testes/6 suítes no total do módulo).

## 8. Motor de Custo Logístico para Promoções (Sprint 26)

`Warehouse.logisticsCostPerUnit` (configurável, mesmo padrão de `leadTimeDays`) + `LogisticsCostReaderService`, que implementa a porta compartilhada `LOGISTICS_COST_READER` (`shared/contracts/tokens.ts`) — o Promotion Intelligence consome só a porta, nunca uma classe concreta deste módulo. Endpoint `PATCH /logistics-fulfillment/warehouses/:id/logistics-cost` (ADMIN/PRICING_EDITOR). Ver `docs/promotion-intelligence-architecture.md` para o racional completo de como esse custo entra na calculadora de margem de campanha.

## 9. Módulo de Separação e Expedição — Pick & Pack (Sprint 27)

Checklist de bipagem (`StockMovementAuditEventItem`) e captura de vídeo em chunks (`VideoCaptureSession`) foram adicionados ao **mesmo** Hub de Provas desta sprint (24), não como um módulo novo — ambos penduram em `StockMovementAuditEvent` via relação 1:N e 1:1, respectivamente. O racional completo de arquitetura (por que MediaDevices API em vez de RTSP, por que uma porta `VideoChunkStorage` separada de `FileStorage`, estratégia de retenção de 30 dias, protocolo de idempotência dos chunks) está em **`docs/pick-pack-architecture.md`** — documento dedicado, dado o tamanho da superfície nova (domínio + aplicação + infra + interface + frontend). Esta seção só registra o ponto de encaixe: `canApprove` (seção 3 acima) ganhou um segundo parâmetro opcional (`items`), com checklist vazio permanecendo vacuamente aprovado — preserva 100% do comportamento legado de `FULL_DISPATCH` de reabastecimento preventivo descrito acima.
