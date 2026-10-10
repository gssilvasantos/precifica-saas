# Criar anúncio de catálogo pelo EAN (Mercado Livre)

Status em 09/10/2026: **em construção** — regras de domínio escritas e testadas; cliente ML, serviço,
endpoint e MCP **ainda não implementados**. Nada foi exercitado contra o Mercado Livre real.

Este documento é o registro da decisão e do procedimento. Foi escrito para virar uma skill
("criação de anúncio de catálogo") ao final.

## 1. Problema

O vendedor tem anúncios **tradicionais** que não possuem anúncio de **catálogo**. Para disputar a
Buy Box e entrar nas campanhas de catálogo, é preciso criar anúncios de catálogo. Decisão do Gui
(09/10/2026): **não vincular ao anúncio tradicional**; ler o EAN de cada tradicional e criar um
anúncio de catálogo independente por esse EAN.

## 2. Decisões do dono (Gui, 09/10/2026)

| Tema | Decisão |
|---|---|
| Onde construir | No Kyneti (não no Mercado Turbo, que não tem API). |
| Vínculo com o tradicional | Nenhum. Só o EAN liga os dois. |
| Estoque inicial | **1 unidade**. O SKU do produto é cadastrado no anúncio; depois o Olist ERP vincula pelo SKU e passa a enviar o estoque real. |
| Preço inicial | Seguir as regras de precificação (Mazzei Pro Seller): custo total (custo + imposto + tarifa + frete) e **40% de margem sobre o preço**. O preço de venda real vem depois, ao entrar numa promoção. |
| EANs próprios | 7908254900004 (RM0134) e 7908254900097 (RM0130) são produtos próprios — fora da regra de piso da marca Catharine Hill. |
| Escrita | Desligada por padrão. Ligar `ML_CAMPAIGN_WRITES_ENABLED` só com confirmação explícita do Gui. Primeiro uso: plano (simulação), depois **um** anúncio com confirmação. |

## 3. Procedimento

1. Listar anúncios tradicionais ativos sem anúncio de catálogo correspondente.
2. Ler o GTIN/EAN (`extractGtin`: atributo GTIN, senão EAN; 8/12/13/14 dígitos). **Anúncio com
   variações: cada variação tem SKU e EAN próprios e gera o SEU anúncio de catálogo** (decisão do
   Gui, 09/10/2026) — o EAN e o SKU vêm da variação, nunca do anúncio. Sem EAN válido → pular e reportar.
3. Buscar a ficha de catálogo pelo GTIN. Sem ficha → pular (não existe catálogo para criar).
4. Obter SKU, custo (catálogo interno), alíquota (Tax Intelligence), categoria e tipo de anúncio.
5. Frete (`shipping_options/free`) e tarifa (`listing_prices`) vêm do ML.
6. Calcular o **menor preço em centavos** com margem >= 40% (`solvePriceForMargin`).
7. Plano (simulação): mostrar EAN, ficha, SKU, preço, margem — sem escrever.
8. Criar (com flag de escrita e confirmação): `POST /items` com `catalog_listing`, estoque 1, `SELLER_SKU`.
9. Depois: vincular no Olist pelo SKU (feito pelo Gui no ERP) e só então o estoque real chega.
10. Depois: colocar numa promoção ao preço de venda real.

## 4. Regras de preço

- Margem sobre o preço: `(preço − custo − imposto − tarifa − frete) / preço`, igual ao Mercado Turbo.
- A tarifa depende do preço e tem **degrau** (taxa fixa abaixo de R$ 79), então a função não é monotônica.
  O solver itera o ponto fixo, sobe até cumprir a margem e **desce enquanto o centavo anterior ainda cumpre**
  (`domain/ml-catalog-listing-creation.ts`). Teste cobre o caso do degrau.
- Piso de marca (ex.: Catharine Hill) continua valendo para produtos dessa marca: não aplicado
  automaticamente nesta funcionalidade — **verificar manualmente** até ser implementado.

## 5. Executado x não executado (09/10/2026)

- **Executado**: `npx jest src/modules/promotion-intelligence` — 7 suítes, 84 testes passando
  (inclui solver, GTIN, payload e o serviço de plano/criação com fakes: isolamento de conta,
  flag desligada, duplicidade, trava de concorrência). `npm run typecheck` sem erros.
  `npm run lint`: 0 erros, 5 avisos (= baseline, não subiu).
- **Escrito, não executado**: endpoints HTTP (nenhum teste de contrato/e2e; e2e exige Postgres).
- **Não implementado**: ferramenta MCP, auditoria persistente, trava de duplicidade em banco
  (hoje em memória, 1 instância), verificação de piso de marca.
- **Pendente**: linha `ML_CATALOG_LISTING_CREATE_ENABLED` em `apps/api/.env.example` — o acesso a
  esse arquivo foi negado nesta sessão; adicionar à mão (vazio = desligado, só "true" liga).

## 4.1 Variações (09/10/2026)

Planilha "sem catálogo" do Mercado Turbo (09/10/2026): 352 tradicionais (239 ativos, 113 pausados);
79 têm variações. Regra: um catálogo por EAN, ou seja, por variação. O plano de um anúncio com
variações exige `variationId` (422 `ML_ITEM_HAS_VARIATIONS` lista as variações); `variations/plan`
planeja todas de uma vez, com o motivo das que não dá. Anúncios repetidos do mesmo produto (ex.:
RM0242-1 a -6) caem na trava de duplicidade (mesma ficha/SKU) — cria-se um por ficha.
Formato das variações no `GET /items/:id` é suposição da documentação, não exercitado.

Esclarecimento do Gui (09/10/2026): o **anúncio-pai com variações nunca terá catálogo** — o catálogo
é por variação; o anúncio simples (sem variação) tem o seu. Por isso a listagem "sem catálogo" do
Mercado Turbo sempre inclui os pais. A verificação certa é **por EAN** (cada EAN tem seu SKU): o plano
traz `existingCatalogListingId` quando a conta já tem catálogo ativo da mesma ficha/SKU, e a criação
recusa (409) nesse caso.

**Fonte da lista (09/10/2026):** a planilha "sem catálogo" levantada no Mercado Turbo foi descartada —
o Gui encontrou anúncios nela que têm catálogo. A fonte confiável é o plano em lote do Kyneti
(`plan-batch`), que consulta o Mercado Livre por EAN: `READY`, `ALREADY_HAS_CATALOG` ou `BLOCKED` (com
motivo). Página de no máximo 5 anúncios por chamada (várias chamadas ao ML por unidade); percorrer
com `offset` até `total`. Não exercitado contra o ML real.

**Desempenho (09/10/2026):** o primeiro `plan-batch` real estourou o timeout de 20s do MCP — listar todos
os anúncios da conta é caro. Correções: cache em memória por tenant (5 min) da lista de anúncios nos
planos de leitura (a criação sempre relê); timeout de 90s no MCP para os planos. Tempo real do lote
não medido; se ainda estourar, reduzir `limit` ou mover para processamento assíncrono.

## 5.1 Endpoints (prefixo `/api/promotion-intelligence/mercado-livre/catalog-creation`)

Auth: JWT + módulo Promoções. `POST .../create` aceita `variationId` no corpo. O `tenantId` vem do token.

| Método | Rota | Papel | O que faz |
|---|---|---|---|
| GET | `/traditional-items?offset&limit` | qualquer com módulo | Tradicionais ativos (limite 100), marca SKU que já tem catálogo |
| GET | `/plan-batch?offset&limit(≤5)&targetMarginPct&taxRatePct` | qualquer com módulo | Plano em lote por EAN (lista confiável do que falta) |
| GET | `/items/:itemId/variations/plan` | qualquer com módulo | Plano de todas as variações (linha por variação, com erro quando não dá) |
| GET | `/items/:itemId/plan?variationId&targetMarginPct&taxRatePct` | qualquer com módulo | Plano: EAN, ficha, SKU, preço, margem. Só lê |
| POST | `/items/:itemId/create` | ADMIN ou PRICING_EDITOR | Cria 1 anúncio. 403 `ML_CATALOG_CREATE_DISABLED` sem a flag; 409 se já existe ou em andamento |

Flag: `ML_CATALOG_LISTING_CREATE_ENABLED=true` (separada de `ML_CAMPAIGN_WRITES_ENABLED`).
Margem alvo mínima aceita: 5% (padrão 40%). Erros do plano são 422 com o motivo (sem EAN, sem
ficha, mais de uma ficha, sem SKU, sem custo, item de outra conta).

## 6. Limitações e premissas NÃO verificadas

- Endpoint de busca de produto de catálogo por GTIN (`/products/search` com `product_identifier`) e o
  formato do `POST /items` com `catalog_product_id` + `catalog_listing: true` são **suposições**
  baseadas na documentação; nunca chamados.
- A categoria do item precisa ser compatível com a da ficha de catálogo; divergência pode ser rejeitada.
- O ML pode recusar anúncio duplicado do mesmo produto/EAN pelo mesmo vendedor.
- A aplicação do app ML precisa de permissão de escrita no painel de desenvolvedores (escopos não conferidos).
- Estoque 1 expõe o anúncio a venda antes do vínculo no ERP: risco de venda sem estoque real; mitigação
  operacional = vincular no Olist logo após criar.
- Tarifa e frete calculados no momento do plano podem mudar até a criação.

## 7. Itens para a skill final

Pré-requisitos (módulo Promoções concedido, flag, permissão ML), fluxo plano → um item → lote, formato
do relatório (criados / pulados e por quê), e checklist pós-criação (vincular Olist, conferir estoque,
promoção). Será consolidada quando a funcionalidade estiver implementada e exercitada.
