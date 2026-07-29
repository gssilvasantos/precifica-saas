# Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling ERP)

Implementado em 29/07/2026, a partir de `docs/bling-erp-benchmark-analysis.md`. Antes desta rodada, `DispatchBatch.formaEnvio` era uma string livre digitada pelo operador (ou vinda do canal de origem do pedido), traduzida por uma tabela hardcoded (`LABEL_STRATEGY_BY_FORMA_ENVIO`, em `dispatch-batch.entity.ts`) só para decidir qual automação de etiqueta usar — sem nenhum cadastro real de transportador/serviço, sem estimativa de prazo de entrega, sem tolerância a variações de digitação do mesmo texto ("Correios", "CORREIOS", "correios ").

## 1. Escopo desta rodada (decisão deliberada)

O Bling modela transportador e serviço de transporte como cadastros próprios, vinculados à etiqueta/expedição do pedido.

**Decisão**: esta rodada adiciona um cadastro `Carrier` (transportador) + `CarrierService` (serviço daquele transportador, com aliases e estimativa de prazo) — mas a integração com `DispatchBatch` é **puramente ADITIVA**: `DispatchBatch.formaEnvio` continua uma `String` livre, exatamente como sempre foi; nenhum gate existente (`canAddOrderToBatch`, `canIncludeInDispatchBatch`, `canGenerateLabelForOrder`, `canConcludeBatch`, `canCancelBatch`) foi alterado, e `DispatchBatchService.createBatch` manteve sua assinatura original (`tenantId, formaEnvio, requestedByUserId?, notes?`). O catálogo só ajuda a **resolver** qual string usar (via `carrierServiceId` opcional na criação do lote) e a **enriquecer** um `formaEnvio` já gravado com o nome do transportador/estimativa de entrega — nunca bloqueia nem transforma o fluxo existente.

**Por que módulo `freight-shipping`, não `logistics-fulfillment`**: mesmo racional de `FreightProviderConnection` — o cadastro de transportador/serviço é uma responsabilidade de "quem é o parceiro logístico", não de "como o lote é despachado". `logistics-fulfillment` já importa `FreightShippingModule` (desde a Fase 5) para consumir `FreightProviderRegistry`; agora também consome `CarrierCatalogService` da mesma forma, sem dependência circular.

## 2. Cadastro — `Carrier` + `CarrierService` (schema `freight_shipping`)

Duas tabelas novas no schema `freight_shipping` já existente:

- `Carrier`: `name` (único por tenant), `isActive` (soft toggle — nunca DELETE físico, mesma filosofia de `VendedorService`/`NaturezaOperacaoService`).
- `CarrierService`: vinculado a um `Carrier` (`onDelete: Cascade`), `name` (único por transportador), `aliases: String[]` (variações de texto que também devem resolver para este serviço — ex.: um serviço chamado "Package" pode ter alias `["JADLOG_PACKAGE", "JADLOG_PKG"]`), `estimativaEntregaDias` (opcional), `automationCode` (opcional — se preenchido, deve bater com um dos códigos que `resolveLabelStrategy` já conhece, nunca um valor livre que criaria uma automação fantasma), `isActive`.

`CarrierCatalogService`: CRUD completo de `Carrier` (create/find/update/setActive) e de `CarrierService` aninhado sob um `Carrier` (create/find/update/setActive), com validação de nome único (por tenant no Carrier, por transportador no Service) e de `automationCode` via `isValidAutomationCode`.

## 3. Domínio — matching de alias (`freight-shipping/domain/carrier-catalog.ts`)

Funções puras, sem Prisma/HTTP, mesmo racional de `tax-code-resolver.ts`:

- `normalizeCarrierAlias`: normaliza texto (remove acentos, caixa alta, espaços viram `_`) para comparação tolerante — a mesma tolerância que qualquer texto livre gravado em `formaEnvio` precisa.
- `matchCarrierServiceByFormaEnvio(formaEnvio, services)`: busca o `CarrierService` ATIVO cujo nome (prioridade) ou algum alias bate com o `formaEnvio` informado, após normalização. Retorna `null` sem lançar quando nada bate — forma de envio sem correspondência cadastrada é um estado válido, só sem enriquecimento.
- `resolveFormaEnvioForService(service)`: resolve a string a gravar em `DispatchBatch.formaEnvio` a partir de um `CarrierService` cadastrado (nome normalizado) — fluxo inverso do match, usado na criação do lote.
- `isValidAutomationCode`: valida que um `automationCode`, se preenchido, é um dos códigos exportados por `KNOWN_FORMA_ENVIO_CODES` (`logistics-fulfillment/domain/dispatch-batch.entity.ts`) — import cross-módulo de constante pura, nunca duplicando a lista.

## 4. Integração aditiva com `DispatchBatch`

`CreateDispatchBatchDto` ganhou `carrierServiceId?: string` e `formaEnvio` virou opcional — exatamente um dos dois deve vir preenchido (validado em `DispatchBatchesController.create`, não no DTO, por ser uma regra "ou um ou outro" entre dois campos). Quando `carrierServiceId` é informado, o controller resolve a string via `CarrierCatalogService.resolveFormaEnvioForCarrierService` **antes** de chamar `DispatchBatchService.createBatch` — que nunca soube, e continua não sabendo, da existência do catálogo.

Novo endpoint de leitura `GET /logistics-fulfillment/dispatch-batches/:id/carrier-match`: busca o lote existente, pega seu `formaEnvio` já gravado e devolve o `CarrierService` correspondente (nome do transportador, estimativa de entrega) via `matchByFormaEnvio` — enriquecimento puro, nunca altera o lote, retorna `null` se nada bater no catálogo.

## 5. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/freight-shipping/carriers` | Cadastra um transportador (ADMIN/PRICING_EDITOR) |
| `GET` | `/freight-shipping/carriers` | Lista os transportadores do tenant |
| `GET` | `/freight-shipping/carriers/match?formaEnvio=...` | Resolve o serviço cadastrado correspondente a um formaEnvio livre |
| `GET` | `/freight-shipping/carriers/:id` | Detalhe de um transportador |
| `PATCH` | `/freight-shipping/carriers/:id` | Atualiza nome (ADMIN/PRICING_EDITOR) |
| `PATCH` | `/freight-shipping/carriers/:id/active` | Ativa/inativa (ADMIN/PRICING_EDITOR) |
| `POST` | `/freight-shipping/carriers/:carrierId/services` | Cadastra um serviço do transportador (ADMIN/PRICING_EDITOR) |
| `GET` | `/freight-shipping/carriers/:carrierId/services` | Lista os serviços do transportador |
| `GET` | `/freight-shipping/carriers/:carrierId/services/:serviceId` | Detalhe de um serviço |
| `PATCH` | `/freight-shipping/carriers/:carrierId/services/:serviceId` | Atualiza nome/aliases/estimativa/automationCode (ADMIN/PRICING_EDITOR) |
| `PATCH` | `/freight-shipping/carriers/:carrierId/services/:serviceId/active` | Ativa/inativa (ADMIN/PRICING_EDITOR) |
| `POST` | `/logistics-fulfillment/dispatch-batches` | Ganhou `carrierServiceId` opcional (alternativa a `formaEnvio`) |
| `GET` | `/logistics-fulfillment/dispatch-batches/:id/carrier-match` | Enriquece o lote com o transportador/serviço correspondente |

## 6. Aplicação manual pendente (tabelas novas em schema existente)

`freight_shipping.carriers` e `freight_shipping.carrier_services` são tabelas novas num schema já existente — não precisam de grant separado (coberto pelo `ALTER DEFAULT PRIVILEGES` de `freight_shipping` desde a Fase 5), só da policy:

```
psql "$DIRECT_URL" -f apps/api/prisma/manual-migrations/2026-07-29_apply_carrier_catalog_rls_only.sql
```

A mesma policy também foi anexada ao arquivo mestre `2026-07-17_enable_row_level_security.sql`. Precisa rodar `npx prisma migrate deploy` ANTES (cria as tabelas novas), só depois o script de RLS acima.

## 7. O que falta (gaps conhecidos)

- Sem UI ainda no frontend — só a API.
- Sem endpoint de exclusão física — só `setActive` (soft toggle), mesma filosofia de todo o resto da base.
- `matchByFormaEnvio` varre todos os serviços ativos do tenant em memória a cada chamada — aceitável para o volume esperado de transportadores/serviços por tenant (dezenas, não milhares); sem índice de busca dedicado.
- Sem sincronização automática de aliases a partir do canal de origem do pedido — o cadastro de aliases é sempre manual, feito pelo operador ao configurar o serviço.
