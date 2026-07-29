# Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP)

Ver `docs/tiny-erp-benchmark-analysis.md`, seção 1.7, para o achado original
(webhook de envio de produto da API v2 legada do Tiny) e a decisão de
arquitetura tomada com o usuário.

## 1. Por que um módulo novo (`marketplace-publishing`)

Até a Fase 4, todo provider de marketplace era **read-only** em relação a
anúncios: `ListingCapableProvider.listActiveListings()` lê anúncios que já
existem no canal para casar por SKU. Não existia nenhuma capacidade de
**criar** um anúncio novo a partir de um produto do Kyneti. Essa é a primeira
vez que a plataforma ganha um fluxo de escrita que cria um recurso público e
irreversível de desfazer (diferente de repricing, que só atualiza um valor
existente) — por isso vive em módulo próprio, com seu próprio Safety Lock.

## 2. Decisão de UX: espelhar o Tiny/Olist, não inventar um modelo novo

O usuário pediu explicitamente para replicar como o ERP Olist resolve o
mapeamento de categoria/atributo hoje ("acho o mapeamento deles perfeito,
muito intuitivo"), confirmado via o artigo oficial da central de ajuda
(`ajuda.olist.com/produtos/categorias-dos-produtos`). O modelo tem três
peças, deliberadamente separadas:

1. **Árvore de categoria interna** (`catalog.ProductCategory`) — profundidade
   arbitrária (self-relation `parentCategoryId`), DIFERENTE da hierarquia de
   1 nível de `Product.parentProductId` (produto pai/variação, Fase 2) e
   também diferente de `Product.internalCategory` (texto livre, sem árvore
   real) — os três coexistem sem se substituir.
2. **Atributos por CATEGORIA, não por produto** (`catalog.CategoryAttribute`)
   — com um flag `extendToChildren`: um atributo cadastrado em "Eletrônicos"
   com `extendToChildren=true` é herdado por "Celulares" e "Acessórios" sem
   precisar recadastrar; um atributo específico de "Celulares" não vaza para
   as categorias-irmãs. `resolveEffectiveAttributes` (domínio puro) resolve a
   cadeia raiz→folha e aplica a regra "a categoria mais específica vence em
   caso de colisão de nome".
3. **Mapeamento categoria↔canal separado** (`ChannelCategoryMapping`) — a
   categoria interna nunca é enviada direto para o marketplace; o usuário
   configura, uma vez por categoria e por canal, qual categoria do Mercado
   Livre/Shopee corresponde, através de uma busca por texto livre na própria
   API do canal (nunca um dropdown com milhares de opções).

## 3. Duas novas capacidades de provider (Interface Segregation)

Mesmo racional de `PRICE_UPDATE`/`ADS_ACTIONS` já usado no resto da base:
capacidade de leitura separada da capacidade de escrita, cada uma com seu
próprio `ProviderCapability` e type-guard (`shared/contracts/marketplace-provider.contract.ts`).

- `CategoryDiscoveryCapableProvider` — `searchCategories(ctx, query)` +
  `getCategoryAttributes(ctx, externalCategoryId)`. Só consultado ao
  CONFIGURAR o `ChannelCategoryMapping`, nunca em toda publicação (exceto
  para reconsultar os atributos obrigatórios no momento do `canPublish`, já
  que a lista pode mudar sem aviso do canal).
- `ListingCreateCapableProvider` — `createListing(ctx, input)`. Só chamado
  depois que o gate `canPublish` já validou o payload.

Implementadas juntas (decisão do usuário via `AskUserQuestion`) em
`MercadoLivreListingProvider` (`domain_discovery/search` + `GET
/categories/:id/attributes` + `POST /items`) e `ShopeeListingProvider`
(`product/get_category` + `product/get_attributes` + upload de imagem prévio
via `media_space/upload_image` + `product/add_item`). Diferença estrutural
relevante: o Mercado Livre aceita busca por texto livre nativamente; a Shopee
só expõe a árvore inteira de categorias, então o filtro por substring roda
no lado do Kyneti (`ShopeeListingProvider.searchCategories`).

## 4. O gate `canPublish` — tudo que dá para validar antes de gastar rede

`domain/listing-publication.entity.ts`, função pura, sem I/O: nome do
produto, ao menos 1 foto, peso informado, categoria interna definida, mapeamento
para o canal de destino existente, e todo atributo marcado como obrigatório
pela categoria do MARKETPLACE (nunca hardcoded — consultado ao vivo)
presente na mescla `effectiveAttributes` (herdados da categoria interna) +
`overrideAttributes` (informados pelo usuário no momento de publicar, ex.:
cor varia por produto mesmo dentro da mesma categoria). Qualquer falha aqui
nunca chega a criar uma tentativa em `ListingPublication` nem a chamar o
provider.

## 5. Append-only-por-tentativa (`ListingPublication`)

Mesmo padrão de `FiscalInvoice` (Fase 3): cada chamada a
`ListingPublicationService.publish` insere uma linha NOVA em
`ListingPublication`, nunca sobrescreve uma tentativa anterior. A máquina de
estados de uma tentativa é `PENDENTE -> (PUBLICADO | ERRO)`, terminal nos
dois casos — permite reconstituir o histórico completo de tentativas de um
produto num canal, inclusive as que falharam, sem perder rastro.

## 6. Safety Lock — publicar é sempre manual

Mesmo racional de `AdsActionDispatcherService` (módulo de Ads, Fase 3):
criar um anúncio público tem consequência externa/reputacional real e
irreversível de desfazer, então `ListingPublicationService.publish` só roda
por ação explícita do usuário (`POST
/marketplace-publishing/listings/publish`, guard `ADMIN`/`PRICING_EDITOR`) —
nunca por scheduler nem automação.

## 7. Vínculo com `ChannelListing` na publicação bem-sucedida

Publicação confirmada pelo marketplace (`success: true` +
`externalListingId`) chama `CHANNEL_LISTING_WRITER.upsert` — nova porta,
irmã de escrita de `CHANNEL_LISTING_READER` (Interface Segregation: nenhum
módulo externo ganha acesso ao `CHANNEL_LISTING_REPOSITORY` completo do
erp-integration, só a fatia `upsert`). Isso é o que faz o SKU aparecer
imediatamente no restante da plataforma (repricing, leitura de preço
vigente) sem esperar o próximo ciclo de sync de listings. Falha nesse
vínculo NUNCA desfaz a publicação já confirmada do lado do canal — só loga
um aviso (o anúncio existe de verdade; o vínculo interno pode ser
reconciliado depois).

## 8. Resolução do produto: por SKU, não por id interno

`ListingPublicationService.publish(tenantId, skuCode, marketplaceCode,
input)` resolve o produto via `PRODUCT_CATALOG_READER.findBySku` — mesmo
padrão já usado por `FiscalInvoiceService`/`PricingDecisionService`. O
`ProductCatalogSummary` ganhou três campos aditivos para isso:
`categoryId`, `photoUrls`, `weightKg` (todos já existiam em `Product`, só não
eram expostos pela porta). `Product.categoryId` também virou editável via
`CreateProductDto`/`UpdateProductDto` (validado contra
`PRODUCT_CATEGORY_REPOSITORY` no `ProductsService`, mesmo racional de
`packagingId`/`parentProductId`).

## 9. Endpoints

- `GET /marketplace-publishing/category-mappings/search?marketplaceCode=&query=`
  — busca por texto livre na API do canal.
- `GET /marketplace-publishing/category-mappings/attributes?marketplaceCode=&externalCategoryId=`
  — atributos exigidos pela categoria escolhida.
- `POST /marketplace-publishing/category-mappings` — salva o vínculo
  (upsert por `tenantId+categoryId+marketplaceCode`).
- `GET /marketplace-publishing/category-mappings?categoryId=` — lista
  mapeamentos de uma categoria.
- `DELETE /marketplace-publishing/category-mappings/:id`.
- `POST /marketplace-publishing/listings/publish` — a ação manual de
  publicar (Safety Lock).
- `GET /marketplace-publishing/listings?productId=` / `GET
  /marketplace-publishing/listings/:id` — histórico de tentativas.

## 10. O que falta (MVP, gaps conhecidos)

- Amazon/Magalu/TikTok não têm `CategoryDiscoveryCapableProvider`/
  `ListingCreateCapableProvider` ainda — adicionar um canal novo é só
  registrar mais um provider em `LISTING_CAPABLE_PROVIDERS`
  (`marketplace-publishing.module.ts`), nenhuma classe existente muda.
- Nenhum dos dois providers foi exercitado contra uma chamada real (mesmo
  aviso de honestidade do resto da base — ver comentários em
  `mercado-livre-api.client.ts`/`shopee-api-client.ts`); validar contra uma
  conta real antes de liberar em produção.
- Frontend (tela de configuração de mapeamento + formulário de publicação)
  ainda não construído — só a API está pronta nesta fase.
- `variacoes[]` (grade de atributos por variação, ver Fase 2) não é
  propagada para o anúncio — hoje cada variação é publicada como um anúncio
  independente, sem vínculo de "produto pai com variações" do lado do canal.
