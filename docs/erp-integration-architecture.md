# ERP Integration (Olist/Tiny) + Canal Nuvemshop — Arquitetura

**Status:** implementado (Etapa 5 + Etapa 5.1 do README).
**Escopo:** (1) importação read-only de produtos do Olist Tiny para o Catalog — fonte única da verdade do catálogo; (2) conexão com a Nuvemshop para vincular SKU × listing (`ChannelListing`) e capturar a taxa dinâmica do gateway Nuvem Pago, reaproveitando a máquina de versionamento do Marketplace Intelligence; (3) primeira fatia do Pricing Intelligence (simulador de margem da Nuvemshop), em `modules/pricing-intelligence/`.

**Nota de escopo, importante:** a Nuvemshop foi pedida "dentro deste módulo" pelo usuário, e os endpoints HTTP dela vivem em `modules/erp-integration/` por isso — mas estruturalmente ela **não é um ERP**. É um canal de venda (como Mercado Livre/Shopee): a taxa de gateway segue o pipeline `MarketplaceRule`/`RuleSyncOrchestrator` (Marketplace Intelligence), não o `ProductCatalogWriter` read-only do Olist. Ver README, Etapa 5.1, para o racional completo dessa divisão.

---

## 1. Isso é o mesmo problema do Marketplace Intelligence — com uma diferença importante

Estruturalmente, "importar produtos do Olist" é o mesmo formato de problema que "importar regras de comissão do Mercado Livre": uma fonte externa, um pipeline de sincronização, necessidade de saber o que mudou e quando. Vou reaproveitar o padrão (Provider, Orchestrator, log/observabilidade de sync) em vez de reinventar.

Mas há uma diferença de confiança que muda o desenho: uma `MarketplaceRule` errada pode corromper o preço mínimo — por isso ela nasce `PENDENTE_VALIDACAO` e exige aprovação humana. Um produto importado do Olist é, por definição sua ("fonte única da verdade"), informação que você já confia — exigir aprovação manual para cada SKU importado contradiria o próprio objetivo ("não quero que o usuário cadastre produtos manualmente"). Então aqui o pipeline **aplica direto** (upsert), sem fila de aprovação — mas mantém histórico de alteração para auditoria, porque "aplicar automático" não é o mesmo que "aplicar sem rastro".

## 2. O ponto central: Product tem dois donos agora

Hoje (Etapa 2) todo campo de `Product` é preenchido manualmente. Com o Olist como fonte da verdade, isso deixa de ser verdade para uma parte dos campos:

| Campo | Dono | Editável via API depois de importado? |
|---|---|---|
| `name`, `skuCode`, `costPrice`, `stockQuantity`, `weightKg`, `packagingWeightKg`, `lengthCm/widthCm/heightCm`, `photoUrls` | **Olist** (espelhado) | Não — só o próximo sync do Olist muda esses campos |
| `desiredMarginPct`, `minimumMarginPct`, `taxProfileId`, `internalCategory` | **Precifica** | Sim, sempre — é configuração que só existe aqui |
| `erpSalePrice` (preço de venda que está no Olist, capturado à parte) | **Olist** (espelhado, informativo) | Não |

Isso exige três mudanças no `Product` (Catalog):

1. **Campos novos de proveniência**: `sourceSystem` (`MANUAL` | `ERP_OLIST`), `externalId` (id do produto no Olist), `lastSyncedAt`.
2. **Campos novos de dados**: `stockQuantity` (não existia — boa lacuna que esse pedido revelou), `photoUrls` (array de string), `erpSalePrice` (decimal, o preço do Olist, sem relação com o motor de precificação da Precifica).
3. **Regra de negócio nova no `ProductsService`**: se `sourceSystem = ERP_OLIST`, o `update()` só aceita os campos que a Precifica é dona (margens, perfil fiscal, categoria interna) — tentar editar `costPrice`/`name`/etc. de um produto importado retorna erro explicando que aquele campo é espelhado do Olist.

## 3. Onde a integração entra sem violar a regra de acoplamento

Seguindo a mesma disciplina do Logistics Intelligence (seção 3 do `platform-architecture.md`): **Catalog continua sendo o único dono da tabela `Product`.** O módulo novo (`erp-integration`) nunca escreve na tabela de outro módulo diretamente — ele depende de uma porta que o Catalog expõe:

```typescript
// shared/contracts/product-catalog-writer.port.ts
export interface ProductCatalogWriteData {
  tenantId: string;
  skuCode: string;
  name: string;
  costPrice: number;
  stockQuantity: number;
  weightKg: number;
  packagingWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  photoUrls: string[];
  erpSalePrice: number;
  sourceSystem: 'ERP_OLIST';
  externalId: string;
}

// Implementado pelo Catalog, consumido pelo erp-integration — é o espelho
// exato do ShippingWeightCalculator (lá o Catalog consome; aqui o Catalog
// expõe). Mesmo princípio, direção invertida.
export interface ProductCatalogWriter {
  upsertFromExternalSource(data: ProductCatalogWriteData): Promise<{ productId: string; changed: boolean }>;
}
```

`upsertFromExternalSource` faz: busca por `(tenantId, skuCode)` → se não existe, cria (com `desiredMarginPct`/`minimumMarginPct` em um valor padrão configurável, já que o Olist não tem esse conceito — precisa de um default sensato, ex.: 20%/8%, editável depois) → se existe, atualiza só os campos espelhados, preservando margem/perfil fiscal já configurados → chama o `ShippingWeightCalculator` (Logistics Intelligence) para recalcular peso cubado, exatamente como no fluxo manual de hoje.

## 4. Autenticação — confirmei contra a documentação oficial do Olist

Pesquisei a API V3 antes de propor isso (não quis assumir): é **OAuth2**, com `client_id`/`client_secret` gerados pelo próprio tenant no painel do Olist (**menu → configurações → Aplicativos**, disponível a partir do plano Construa). Isso confirma o desenho de `AuthStrategy` com `scope: 'TENANT'` que já deixamos pronto em `shared/contracts/auth-strategy.contract.ts` no Marketplace Intelligence — primeira vez que ele é de fato usado.

**A garantia de "apenas leitura" fica em duas camadas, não uma:**
1. **Técnica**: `OlistApiClient` só implementa métodos GET. Não existe, em nenhum lugar do código, uma chamada POST/PUT/DELETE para o Olist — não é política, é ausência física do caminho de código.
2. **Operacional, e mais forte**: a própria Olist permite configurar o "Aplicativo" com permissão **Leitura** por módulo (Produtos, Estoque). Vou documentar no README que o tenant deve criar o aplicativo com permissão só de leitura nesses módulos — nesse caso, mesmo que um bug futuro tentasse escrever, a própria conta Olist rejeitaria a chamada. Duas camadas de proteção para uma promessa que você fez questão de destacar.

Rate limit confirmado: 60–240 requisições/minuto conforme plano do tenant — o orquestrador de sync precisa respeitar isso (throttling por tenant, não só por provider, já que aqui — diferente do Mercado Livre — cada tenant tem sua própria conta/limite).

## 5. Modelo de dados novo

```prisma
// schema erp_integration

model OlistConnection {
  tenantId          String   @id
  clientId          String
  clientSecretEnc   String   // criptografado em repouso
  accessTokenEnc    String?
  refreshTokenEnc   String?
  tokenExpiresAt    DateTime?
  isActive          Boolean  @default(true)
  lastSyncedAt      DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model ErpSyncChangeEvent {
  id            String   @id @default(uuid())
  tenantId      String
  externalId    String   // id do produto no Olist
  skuCode       String
  changeSummary String   // diff legível — reaproveita a mesma função de hash/diff do Marketplace Intelligence
  action        String   // CREATED | UPDATED | UNCHANGED
  syncedAt      DateTime @default(now())

  @@index([tenantId, syncedAt])
}
```

**Refatoração que este módulo revela ser necessária:** `ProviderSyncSchedule`, `ProviderSyncLog` e `ProviderHealth` hoje moram no schema `marketplace_intelligence`, mas nada ali é específico de marketplace — é infraestrutura genérica de "orquestrar sincronizações externas periódicas". Com um segundo módulo precisando exatamente disso, o momento certo é extrair essas três tabelas para um schema compartilhado (`integration_ops`) antes de duplicá-las. Vou fazer essa extração como parte desta etapa, atualizando o Marketplace Intelligence para consumir do local novo (sem mudar nenhum comportamento existente).

## 6. Pipeline (reaproveitando o `content-hash.ts` do Marketplace Intelligence — promovido para `shared/domain/`)

```
Scheduler (a cada N min, respeitando rate limit do plano do tenant)
  → OlistApiClient.fetchActiveProducts()  [só GET]
  → normaliza (título, SKU, custo, preço venda, estoque, peso, dimensões, fotos)
  → hash do payload normalizado vs. último ErpSyncChangeEvent daquele SKU
  → se igual: não faz nada (evita ruído)
  → se diferente: ProductCatalogWriter.upsertFromExternalSource(...) [via porta do Catalog]
  → grava ErpSyncChangeEvent (CREATED | UPDATED)
  → emite evento de domínio `erp-product.synced` (futuro: Analytics/AI Intelligence podem reagir)
```

Sem estado `PENDENTE_VALIDACAO` aqui — a diferença de confiança explicada na seção 1.

## 7. O que fica para depois (fora do escopo desta etapa, de propósito)

- **Vínculo por SKU com anúncios do ML/Shopee**: exige um `ChannelListing` (produto ↔ anúncio externo) que ainda não existe em nenhum módulo. É o gatilho natural para o próximo módulo depois deste — provavelmente parte do Catalog ou um "Channel Integration" dedicado. Não construo agora para não misturar dois escopos numa única entrega.
- **Import de imagens de fato** (baixar/hospedar): a regra "nunca alterar o ERP" já está garantida; o que falta decidir é se a Precifica só guarda as URLs (mais simples, mas depende do Olist manter essas URLs acessíveis) ou espelha os arquivos (mais robusto, mais caro). Proponho começar só com URLs — é reversível, e complicar isso agora seria otimizar um problema que ainda não apareceu.
- **Nuvemshop**: você mencionou que a loja roda nela, mas o Olist já centraliza o catálogo vindo de lá — não há necessidade de uma segunda integração agora. Se no futuro precisar de dado que só existe na Nuvemshop e não chega ao Olist, o padrão de provider já comporta um `NuvemshopProductProvider` sem tocar no resto.

---

## 8. Decisões confirmadas e um ajuste técnico que elas trazem

**Margem padrão**: 20% desejada / 8% mínima para produtos recém-importados, mas não fixo no código — vira `CatalogSettings` (novo, schema `catalog`, `{tenantId, defaultDesiredMarginPct, defaultMinimumMarginPct}`), seguindo o mesmo padrão do `LogisticsSettings.cubicWeightFactor`: um valor de sistema com default sensato, configurável por conta sem precisar mexer em código.

**Fotos espelhadas**: isso muda a seção 7 — não é mais "fora de escopo". Precisa de um `FileStorage` (porta em `shared/contracts/`) com uma implementação em disco local para começar (`LocalFileStorageService`, servido como estático via `/uploads`), trocável por S3/R2/GCS depois sem tocar em quem consome — mesmo princípio de porta/adaptador do resto do sistema. O download da imagem continua sendo uma chamada GET à URL pública do Olist — não muda a garantia de "nunca escrever no ERP".

**Ajuste técnico que decidi ao escrever o client**: entre API V2 (token estático por conta) e V3 (OAuth2, exige app "Construa" e endpoints que eu não conseguiria verificar ao vivo neste ambiente), vou implementar contra a **V2** nesta primeira entrega — token único gerado pelo próprio tenant no painel do Olist, sem fluxo de autorização OAuth para construir às cegas. V3 fica documentada como evolução natural quando os endpoints puderem ser validados contra uma conta real. Isso simplifica bastante o `OlistConnection` (um campo de token, não client_id/secret/refresh) e ainda cumpre 100% a exigência de leitura apenas.


