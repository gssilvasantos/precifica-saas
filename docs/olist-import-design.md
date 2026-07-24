# Importação de Catálogo Olist — estado atual e próximos passos reais

**Correção de premissa, antes de mais nada:** este documento foi pedido como um "rascunho de como a importação deve mapear os dados do Olist para o nosso modelo de produto" — mas essa importação **já está construída, integrada e documentada**, desde a Etapa 5 (`docs/erp-integration-architecture.md`). Não é o próximo passo de infraestrutura pendente; é um pipeline funcionando hoje: conexão por token (`OlistConnectionService`, `OlistConnection` schema), cliente HTTP (`OlistApiClient`, API V2 do Tiny), normalizador (`olist-product-normalizer.ts`), orquestrador com diff por hash (`ErpSyncOrchestrator`) e escrita no catálogo via porta (`CatalogSyncWriterService` implementa `ProductCatalogWriter`).

O que este documento faz, então: (1) registra o mapeamento **de fato implementado**, campo a campo, para servir de referência rápida; (2) separa claramente o que é espelhado do Olist do que é e continua sendo exclusivamente do Precifica; (3) lista as lacunas reais que ainda existem — essas sim, candidatas legítimas a próximo passo de infraestrutura, quando chegar a hora.

---

## 1. Pipeline já construído (visão rápida)

```
OlistConnection (token AES-256-GCM)
   -> OlistApiClient.fetchAllActiveProductDetails()   [produtos.pesquisa.php + produto.obter.php, paginado]
   -> normalizeOlistProduct()                         [domain/olist-product-normalizer.ts — rejeita payload malformado]
   -> computeContentHash() + diff via ErpSyncChangeEvent  [pula produto se nada mudou desde o último sync]
   -> ProductPhotoMirrorService.mirrorAll()            [só quando o hash mudou]
   -> CatalogSyncWriterService.upsertFromExternalSource()  [cria ou atualiza Product]
```

Agendado por `ErpSyncOrchestrator.syncAllTenants()` (job periódico), isolado por tenant — uma conta com token inválido não trava a sincronização das demais.

## 2. Mapeamento de campos — Olist (Tiny API V2) → Product

| Campo bruto do Olist (`produto.obter.php`) | Campo normalizado (`NormalizedOlistProduct`) | Campo em `Product` | Observação |
|---|---|---|---|
| `id` | `externalId` | `externalId` (+ `sourceSystem: 'ERP_OLIST'`) | Chave de vínculo — **não** é `skuCode` (ver seção 4). |
| `codigo` | `skuCode` | `skuCode` | Obrigatório; produto sem código é rejeitado pelo normalizador. |
| `nome` | `name` | `name` | Campo espelhado — trava edição manual (`ERP_OWNED_FIELDS`). |
| `preco_custo` | `costPrice` | `costPrice` | Espelhado, trava edição manual. |
| `preco` | `erpSalePrice` | `erpSalePrice` | Só informativo/comparação na UI — nunca alimenta o motor de precificação. |
| `estoque_atual` ou `saldo` | `stockQuantity` | `stockQuantity` | Ver lacuna de multi-depósito, seção 5. |
| `peso_liquido` | `weightKg` | `weightKg` | Espelhado, trava edição manual. |
| `peso_bruto` − `peso_liquido` | `packagingWeightKg` | `packagingWeightKg` | Calculado, não lido direto. |
| `comprimento` / `largura` / `altura` | `lengthCm` / `widthCm` / `heightCm` | idem | Espelhados, travam edição manual. Produto com dimensão ausente/zero é rejeitado pelo normalizador (não fica meio-cadastrado). |
| `anexos[].anexo` ou `imagens[]` | `photoUrls` | `photoUrls` | Espelhadas via `ProductPhotoMirrorService` antes de gravar (URL interna, não a do Olist). |

Campos derivados no momento da escrita (não vêm do Olist): `packedWeightKg`, `cubicWeightKg`, `shippingWeightKg` — recalculados a cada sync via `ShippingWeightCalculator`, a mesma porta usada no fluxo de edição manual.

## 3. O que nunca vem do Olist — e por quê

Estes campos existem em `Product` mas são **exclusivamente do Precifica**, mesmo em produtos com `sourceSystem: ERP_OLIST` (ver `product-ownership-rules.ts`, `ERP_OWNED_FIELDS`, e os comentários do schema):

| Campo | Por quê fica de fora do sync |
|---|---|
| `desiredMarginPct` / `minimumMarginPct` | No primeiro import, herdam o default do tenant (`CatalogSettings.getDefaultMargins`, 20%/8% se nunca configurado). Depois disso, edição manual não é mais sobrescrita pelo sync — é estratégia de precificação, não fato físico. |
| `mapPrice` | Piso contratual com fornecedor/marca — o Olist não tem esse conceito. |
| `autoRepricingEnabled` | Decisão de automação do Precifica, opt-in por SKU. |
| `packagingId` / `isKit` | Vínculo com `Packaging` (embalagem individual ou de agrupamento) — conceito só existe no Precifica. |
| `internalCategory` | Categoria interna do Precifica — **não** puxa a categoria do Tiny (ver lacuna, seção 5). |
| `supplierId`, `taxProfileId` | Cadastro próprio do Precifica (`Supplier`, `TaxProfile`) — nunca resolvido automaticamente a partir do Olist. |

Essa separação já é reforçada em runtime: `assertEditableFields()` lança `LockedFieldEditError` se alguém tentar editar manualmente um dos `ERP_OWNED_FIELDS` de um produto `ERP_OLIST` — o campo só muda no próximo sync.

## 4. Identidade e reconciliação

- A chave de upsert é `(tenantId, sourceSystem, externalId)` — o `id` interno do Olist, não o `skuCode`. Consequência documentada no código: se o SKU for renomeado no Olist, o produto certo continua sendo atualizado (o vínculo não se perde), mas o `skuCode` no Precifica **não** acompanha o rename automaticamente — fica como está até uma correção manual ou uma evolução futura.
- Produto nunca visto antes (novo `externalId`) é criado; produto já visto é atualizado só nos campos da tabela da seção 2.
- Diff por hash (`computeContentHash` sobre o payload normalizado, antes do espelhamento de fotos) evita trabalho redundante: produto sem mudança real não dispara novo download de foto nem novo `upsert`.

## 5. Lacunas reais — candidatas a próximo passo de infraestrutura

Diferente do que o pedido original presumia, o pipeline não precisa ser desenhado — mas tem gaps concretos, nenhum bloqueante para o uso atual:

1. **Nomes de campo não validados contra uma conta real e autenticada.** Documentado no próprio código (`olist-api.client.ts`, `olist-product-normalizer.ts`) — os nomes (`preco_custo`, `peso_liquido`, `anexos`, etc.) vêm do conhecimento público da API V2 do Tiny, não de uma chamada autenticada real neste ambiente. Antes de qualquer sync em produção com uma conta de cliente de verdade: rodar um sync de teste e conferir os logs de warning do normalizador (ele rejeita e loga em vez de gravar campo errado silenciosamente).
2. **Estoque single-depósito.** `estoque_atual`/`saldo` é lido como um número único. O Tiny/Olist tem conceito de múltiplos depósitos — se algum tenant operar assim, o sync atual soma/pega um valor só, sem granularidade por depósito. Não é usado hoje (o módulo de Full Fulfillment tem seu próprio conceito de `Warehouse`, sem ligação com o depósito do Olist ainda).
3. **Categoria do Tiny não é aproveitada.** O Precifica tem `internalCategory` (campo livre, editável manualmente) mas nunca sugere/preenche a partir da categoria cadastrada no Olist — hoje fica sempre em branco até edição manual. Ganho potencial baixo-esforço: usar a categoria do Tiny como sugestão inicial (não como campo travado).
4. **NCM e dados fiscais não mapeados.** O Tiny tem NCM por produto; o Precifica tem `TaxProfile` como cadastro próprio, sem nenhuma ponte entre os dois. Relevante para o Bloco 3 do sprint de layout (Config Fiscais) — vale decidir ali se compensa criar essa ponte ou manter `TaxProfile` 100% manual.
5. **Produtos compostos/kits do Tiny não reconciliados.** `isKit` no Precifica é um conceito próprio (embalagem de agrupamento, Sprint 26). O Tiny tem sua própria noção de produto "composição" — hoje não há nenhuma tentativa de casar as duas coisas; um kit cadastrado como composição no Tiny chega ao Precifica como produto comum.

Nenhuma dessas cinco lacunas impede o uso do que já existe. Ficam registradas aqui para quando o backlog de infraestrutura for retomado — a essa altura, a pergunta certa não é "como importar o catálogo Olist" (já resolvida), e sim qual dessas cinco lacunas (provavelmente a 3 ou a 4, pelo menor esforço/maior valor) vale a pena fechar primeiro.

## 6. Referências

- `docs/erp-integration-architecture.md` — arquitetura completa da Etapa 5 (mais detalhada que este documento).
- `apps/api/src/modules/erp-integration/domain/olist-product-normalizer.ts`
- `apps/api/src/modules/erp-integration/infrastructure/olist/olist-api.client.ts`
- `apps/api/src/modules/erp-integration/application/erp-sync-orchestrator.service.ts`
- `apps/api/src/modules/catalog/application/catalog-sync-writer.service.ts`
- `apps/api/src/modules/catalog/domain/product-ownership-rules.ts`
