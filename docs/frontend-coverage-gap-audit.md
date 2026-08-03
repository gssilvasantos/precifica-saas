# Auditoria: Backend construído x Frontend visível (31/07/2026)

> ## ✅ RESOLVIDO — verificado em 01/08/2026
>
> **Este documento está histórico.** Praticamente todos os 13 itens abaixo ganharam tela desde então. Conferido arquivo por arquivo em `apps/web/src/routes/`: `PurchaseOrdersPage`, `SellersPage`, `SuppliersPage`, `FiscalInvoicesPage`, `DispatchBatchesPage`, `LotsPage`, `PriceListsPage`, `CarriersPage`, `ProductionOrdersPage`, `CompetitionRadarPage`, `MarketplaceGovernancePage`, `PackagingPage`, `TagsPage` — todos existem, com os `features/*/api.ts` correspondentes.
>
> Mantido no repositório porque o **raciocínio de priorização** (Tier 1 = dinheiro e compliance) continua útil como referência para auditorias futuras. Não use a lista como backlog: ela não reflete mais o estado do código.
>
> Ver `revisao-geral-2026-08.md` §6 para a verificação.

Levantamento completo de todos os 58 controllers do backend (`apps/api/src/modules/*/interface/controllers`) contra todas as chamadas reais feitas pelo frontend (`apps/web/src/features/*/api.ts`), confirmando endpoint por endpoint. Objetivo: identificar tudo que já está pronto e testado no backend mas que você não consegue usar hoje porque não existe tela.

## Resumo

De 58 controllers, **13 conjuntos de funcionalidade têm ZERO tela no frontend** — o backend responde, tem testes passando, mas não há nenhum botão, formulário ou link que chegue lá. Isso representa um volume grande de trabalho já pago (schema, domínio, testes, docs) que está tecnicamente "pronto" mas comercialmente inacessível.

## O que já está 100% visível e usável

Pedidos, Ads (dashboard + alertas + ações + IA), Catálogo (produtos + Governança MAP), Promoções, Financeiro (só DRE — ver gap abaixo), Abastecimento (reposição + lead time), Conferência (bipagem + vídeo), Integrações (Nuvemshop, Olist, Mercado Livre, Shopee), Configurações Fiscais (perfis fiscais + margens + política financeira), Administração da Plataforma, Equipe, Dashboard.

## Lacunas — por prioridade de negócio

### Tier 1 — Dinheiro e compliance (maior risco de ficar sem essas telas)

| Funcionalidade | Backend | Frontend | O que falta |
|---|---|---|---|
| Contas a Pagar | `financial-intelligence/accounts-payable.controller.ts` — CRUD completo, parcelas, baixa com juros/desconto | Nenhuma | Tela de lançamento e baixa de contas a pagar. A FinanceiroPage hoje só mostra o DRE. |
| Despesas Fixas | `financial-intelligence/fixed-expenses.controller.ts` | Nenhuma | CRUD de despesas fixas recorrentes (usadas no piso financeiro de precificação). |
| Recebíveis / Reconciliação | `financial-intelligence/receivables.controller.ts` + `settlement-import.controller.ts` | Nenhuma | Tela de conferência de repasses dos marketplaces contra o esperado. |
| Emissão de NF-e | `fiscal/fiscal-invoices.controller.ts` | Nenhuma | Não existe tela para emitir, consultar status ou baixar o XML/DANFE de uma nota. O backend já integra com Focus NFe (webhook incluído) mas é 100% invisível. |
| Configurações Fiscais avançadas | `fiscal/fiscal-settings.controller.ts`, `naturezas-operacao.controller.ts`, `fiscal-marketplace-intermediaries.controller.ts` | Nenhuma | Cadastro de Natureza de Operação (CFOP), intermediador de marketplace na NF-e, e configuração geral do emissor fiscal. A tela atual de "Configurações Fiscais" só cobre perfis fiscais e margens — nada de NF-e em si. |

### Tier 2 — Catálogo avançado

| Funcionalidade | Backend | Frontend | O que falta |
|---|---|---|---|
| Fornecedores | `catalog/suppliers.controller.ts` | Nenhuma | CRUD de fornecedores (usado em Ordem de Compra). |
| Embalagens | `catalog/packaging.controller.ts` | Nenhuma | CRUD de embalagens (usado no custo efetivo e dimensões de envio). |
| Lista de Preços | `catalog/price-lists.controller.ts` | Nenhuma | CRUD de listas de preço com exceções por canal/cliente. |
| Lotes (FEFO/validade) | `logistics-fulfillment/lot-stock.controller.ts` | Nenhuma | Lançamento/consulta de saldo por lote e sugestão FEFO — o cadastro do lote em si fica em Produtos, mas a movimentação de estoque por lote não tem tela. |

### Tier 3 — Operação

| Funcionalidade | Backend | Frontend | O que falta |
|---|---|---|---|
| Vendedores + Comissão | `sellers/vendedores.controller.ts` + `commissions.controller.ts` | Nenhuma | Cadastro de vendedor, atribuição a pedido, relatório de comissão e geração da conta a pagar do repasse. |
| Ordem de Compra | `procurement/purchase-orders.controller.ts` | Nenhuma | Emitir OC para fornecedor, acompanhar status, receber (credita estoque + lança conta a pagar). |
| Ordem de Produção (BOM) | `production/production-orders.controller.ts` | Nenhuma | Iniciar/concluir produção a partir da estrutura de produto (BOM) já cadastrada. |
| Transportador / Serviço | `freight-shipping/carriers.controller.ts` + `freight-connections.controller.ts` | Nenhuma | Catálogo de transportadoras e conexões com Melhor Envio/Olist Envios/Frenet/Correios. |
| Expedição em Lote | `logistics-fulfillment/dispatch-batches.controller.ts` | Nenhuma | Agrupar pedidos, gerar etiqueta, concluir lote de despacho — é o passo depois da Conferência. |

### Tier 4 — Crescimento / Marketplace

| Funcionalidade | Backend | Frontend | O que falta |
|---|---|---|---|
| Publicar Anúncio Novo | `marketplace-publishing/listing-publications.controller.ts` + `channel-category-mappings.controller.ts` | Nenhuma | Publicar um produto do catálogo direto num marketplace novo (ML/Shopee), incluindo mapeamento de categoria. |
| Radar de Concorrência | `competition-intelligence/competitive-opportunities.controller.ts` | Nenhuma | Cadastrar concorrentes a monitorar e ver oportunidades de preço — hoje só existe o motor, sem painel. |
| Painel de Governança Marketplace Intelligence | `marketplace-intelligence/marketplace-providers.controller.ts`, `marketplace-rules-admin.controller.ts`, `marketplace-change-events.controller.ts` | Nenhuma | Revisar/aprovar regras de taxa capturadas automaticamente dos marketplaces. |
| Fator de peso cúbico | `logistics-intelligence/logistics-settings.controller.ts` | Nenhuma | Um único campo de configuração — baixo esforço, baixo impacto. |

### Tier 5 — Utilitário

| Funcionalidade | Backend | Frontend | O que falta |
|---|---|---|---|
| Tags | `tagging/tags.controller.ts` | Nenhuma | Marcadores genéricos em Produtos/Pedidos/Contas — cross-cutting, não amarrado a nenhum módulo específico. |

### Gap menor — já parcialmente coberto

- `pricing-intelligence/apply-pricing-decision.controller.ts` (aplicar decisão de repreficação manualmente) não é chamado por nenhuma tela — hoje o repricing automático roda só via `autoRepricingEnabled` no produto. Não é crítico, mas vale um botão "Aplicar agora" na tela de Produto.

## Observação sobre o Painel de Equipe

Todos os 13 itens acima **não têm `ModuleCode` correspondente** no sistema de controle de acesso que acabamos de construir — ou foram mapeados para o módulo mais próximo (ex.: Vendedores → FINANCE, Ordem de Compra → REPLENISHMENT), então já herdam a proteção por módulo assim que ganharem tela. Não é preciso refazer nada de segurança quando essas telas forem construídas.
