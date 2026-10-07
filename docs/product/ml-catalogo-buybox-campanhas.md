# Buy Box + Campanhas do Mercado Livre (catálogo)

Data: 07/10/2026 · Pedido: Gui (substituir rotina manual no Mercado Turbo)

## Problema

Para cada anúncio de catálogo (23 páginas no Mercado Turbo), o Gui abria a
Central de Promoções e inscrevia o anúncio nas campanhas do vendedor e
tradicionais (Outubro, Novembro, Dezembro, 10.10, 11.11), escolhendo um preço
que ganhasse a buy box sem derrubar a margem de contribuição abaixo de 5%.

## Regra (domain/ml-catalog-campaign-planner.ts)

1. Sem estoque → não mexe.
2. Alvo = `price_to_win` do ML (perdendo) ou preço atual (ganhando/empatado),
   arredondado para baixo no centavo e limitado à faixa aceita pela campanha.
3. Margem no alvo ≥ mínimo (padrão 5%) → entra com o alvo (`BUY_BOX`).
4. Senão, margem no preço atual ≥ mínimo → entra mantendo o preço atual
   (`KEEP_CURRENT_PRICE`). Decisão confirmada pelo Gui em 07/10/2026.
5. Senão → `SKIP_MARGIN`. Nunca entra abaixo do mínimo.
6. Só `SELLER_CAMPAIGN` e `DEAL`. Smart, cupom e relâmpago ficam fora.
7. Já participa → `ALREADY_IN`, ou `LOWER_SUGGESTED` quando um preço menor
   ganharia a buy box com margem OK (só sugestão, não altera).

Margem de contribuição = preço − custo (Olist) − imposto − tarifa de venda ML
(`listing_prices`) − frete pago pelo vendedor (`shipping_options/free`), em %
do preço. Conferida contra a coluna "M.C." do Mercado Turbo em dois casos
reais (ver `ml-catalog-campaign-planner.spec.ts`).

## API

| Método | Rota | Papel |
|---|---|---|
| GET | `/promotion-intelligence/mercado-livre/catalog/items?offset&limit` | qualquer, módulo PROMOTIONS |
| GET | `/promotion-intelligence/mercado-livre/catalog/items/:itemId/plan?minMarginPct&taxRatePct` | qualquer, módulo PROMOTIONS |
| POST | `/promotion-intelligence/mercado-livre/catalog/items/:itemId/promotions` `{promotionId, dealPrice, minMarginPct?, taxRatePct?}` | ADMIN / PRICING_EDITOR |

O POST recalcula tudo no servidor (tipo e faixa da campanha, estoque, margem)
e recusa com 422 antes de escrever no ML. Toda escrita gera log de auditoria
(`MlCatalogCampaignService`).

Alíquota: Tax Intelligence por produto; `taxRatePct` sobrescreve (o Mercado
Turbo usa 7,3% cadastrado à mão).

MCP: `kyneti_list_ml_catalog_items`, `kyneti_plan_ml_catalog_campaigns`,
`kyneti_join_ml_promotion` (escrita, atrás de `MCP_ALLOW_WRITES` + `confirm:true`).

## Limitações conhecidas (não exercitadas contra a API real)

- Shapes de `price_to_win`, `seller-promotions/items` e
  `shipping_options/free` vêm da documentação pública; parse defensivo, mas
  nunca rodaram contra o ML neste sandbox. Primeiro uso real deve ser só `plan`.
- Semântica de `min_discounted_price`/`max_discounted_price` é ambígua; o
  planejador usa apenas "menor e maior dos dois" como faixa.
- Frete tratado como fixo por anúncio (não recalculado por preço). Abaixo de
  R$ 79 o custo real do vendedor pode variar.
- Listagem de catálogo herda o teto de 1.000 anúncios de `fetchSellerItemIds`.
- Conta de serviço do MCP precisa do módulo PROMOTIONS (antes não tinha).
