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
2. Ler o GTIN/EAN do tradicional (`extractGtin`: atributo GTIN, senão EAN; 8/12/13/14 dígitos).
   Sem EAN válido → pular e reportar.
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

- **Executado**: `npx jest ...ml-catalog-listing-creation` — 6 testes passando (solver, GTIN, payload).
- **Escrito, não executado**: nada além do acima.
- **Não implementado**: cliente ML (busca por GTIN, criação), serviço de aplicação, controller/DTO,
  trava de idempotência, auditoria, ferramenta MCP, testes de isolamento de tenant/autorização.

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
