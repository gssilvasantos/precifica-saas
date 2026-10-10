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

## Travas de escrita (09/10/2026, após revisão de segurança do PR #1)

- **Flag de backend, falha fechada:** `ML_CAMPAIGN_WRITES_ENABLED=true` na API é obrigatória para inscrever
  em campanha (REST e MCP). Sem ela, `join()` responde 403 `ML_CAMPAIGN_WRITES_DISABLED` antes de qualquer
  chamada ao ML. `MCP_ALLOW_WRITES` continua só registrando/ocultando a tool no MCP; **não** protege o REST.
- **Piso de margem fixo em 5%:** `minMarginPct` abaixo de 5 é recusado (400, DTO e serviço). O cliente só pode
  exigir margem maior.
- **Sem reenvio em timeout no POST:** `joinItemPromotion` retenta apenas HTTP 429; timeout não é retentado
  (o ML pode ter processado). Antes de reenviar, o status da campanha é relido (`candidate`).
- **Trava de duplo envio:** inscrições simultâneas do mesmo tenant+anúncio+campanha → 409
  `ML_CAMPAIGN_JOIN_IN_PROGRESS`. **Limitação:** a trava é em memória (uma instância da API). Com mais de
  uma instância, é preciso trava no banco.
- Continuam abertos (não corrigidos): conferência de que o anúncio pertence ao vendedor da conexão, tradução
  do erro bruto do ML + `AlertService` na falha de inscrição, cache da listagem, auditoria persistente,
  rate limit de entrada. Contrato com a API real do ML segue **não exercitado**.

## MAP na adesão a campanha (10/10/2026)

- O preço da promoção é preço anunciado, então **nunca fica abaixo do MAP** do SKU (`Product.mapPrice`).
  Premissa do Gui: MAP vale para qualquer preço anunciado (ele não a confirmou explicitamente para promoção
  — confirmar com a marca se houver dúvida).
- Planejador (`planItem`, parâmetro `mapPrice`): preço da buy box abaixo do MAP é descartado e cai para o
  preço atual, se este respeita o MAP e a margem; se todo preço possível fica abaixo do MAP, a ação é
  `SKIP_MAP` (nunca entra). Comparação inclusiva (preço = MAP é aceito).
- `join()`: preço abaixo do MAP → 422 `MAP_PRICE_VIOLATION`, sem chamada ao ML, independentemente da margem.
- A resposta do plano traz `mapPrice` (null = SKU sem MAP, sem restrição).
- Não exercitado contra o ML real; coberto por testes com fakes (planejador e serviço).
