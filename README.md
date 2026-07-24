# Precifica SaaS — Plataforma de Inteligência para Marketplaces

Base de código do produto descrito em `PRD-Arquitetura-Precificacao-Inteligente.md`. Este README é atualizado a cada etapa da implementação.

**Documentos de arquitetura (ler nesta ordem ao entrar no projeto):**
1. `docs/platform-architecture.md` — visão geral da plataforma, bounded contexts, regras de acoplamento entre módulos (north star).
2. `docs/marketplace-intelligence-architecture.md` — desenho detalhado do módulo Marketplace Intelligence (próximo módulo a ser implementado).

## Estrutura do projeto

```
precifica-saas/
  docker-compose.yml        # Postgres + Redis para desenvolvimento local
  docs/                      # Documentos de arquitetura (ler antes de mexer no código)
  apps/
    api/                     # Backend NestJS (módulo único por enquanto — vira monorepo quando o frontend entrar)
      prisma/
        schema.prisma        # Modelo de dados, organizado por schema Postgres (identity/catalog/logistics_intelligence/marketplace_intelligence/integration_ops/erp_integration)
      src/
        main.ts               # Bootstrap da aplicação
        app.module.ts          # Módulo raiz — só importa os módulos de bounded context
        shared/
          prisma/               # Serviço de acesso ao banco (Prisma Client) — usado por todos os módulos
          contracts/             # Portas (interfaces) e tokens de DI compartilhados entre módulos
          domain/                # Lógica de domínio pura reutilizada por mais de um módulo (ex.: content-hash.ts)
          security/              # Infra genérica de segurança reutilizável (ex.: criptografia de credenciais)
          sync-ops/              # Infra genérica de sincronização externa (schedule/log/health) — usada por Marketplace Intelligence e ERP Integration
        modules/
          identity-access/        # Tenant, User, autenticação JWT, RBAC — o único módulo transversal
            domain/                 # Entidades e tipos de domínio (sem dependência de Nest/Prisma)
            application/             # Casos de uso (services) + portas de repositório
            infrastructure/           # Implementação Prisma das portas + estratégia JWT
            interface/                 # Controllers, DTOs, guards, decorators (HTTP)
            public-api.ts              # Único ponto por onde outros módulos importam deste
          catalog/                 # Product (SKU), Supplier, TaxProfile, CatalogSettings — mesmas 4 camadas
          logistics-intelligence/  # Peso cubado/peso de cobrança — mesmas 4 camadas
          marketplace-intelligence/ # Regras de comissão/taxa/política, versionadas e multi-fonte
          erp-integration/         # Importação read-only do catálogo do Olist Tiny (fonte única da verdade) + Nuvemshop
          pricing-intelligence/    # Primeira fatia: simulador de margem da Nuvemshop
    web/                       # Frontend React + Vite + TypeScript (Etapa 6)
      src/
        main.tsx                 # Bootstrap (React Query + AuthProvider)
        App.tsx                  # Rotas
        routes/                  # Páginas e layout (LoginPage, AppLayout, ProductPricingPage, ProtectedRoute)
        features/                # Um diretório por bounded context consumido: auth/, catalog/, channels/, pricing/
        lib/                     # api-client.ts (axios + JWT), utilitários
```

Cada módulo de negócio segue Clean Architecture (domain → application → infrastructure/interface, dependência sempre apontando para dentro) e só se comunica com outro módulo através de uma porta explícita — nunca lendo a tabela Prisma de outro módulo diretamente. Ver `docs/platform-architecture.md`, seções 3 e 4, para o racional completo.

## Etapa 1 — Fundação (infra, multi-tenant, autenticação)

**Por que essa etapa vem primeiro:** o PRD (seção 1.1) exige multi-tenant desde o dia 1. Todo módulo de negócio (produto, preço, concorrente) vai depender de `tenantId` e de um usuário autenticado com papel (role) definido. Construir isso depois seria retrabalho em cada módulo já existente.

**O que foi implementado:**
- `docker-compose.yml`: Postgres 16 e Redis 7 para rodar localmente.
- `prisma/schema.prisma`: modelos `Tenant`, `User` (com `role`: ADMIN, PRICING_EDITOR, VIEWER) e enum `UserRole`. E-mail é único **por tenant**, não globalmente — decisão intencional de multi-tenant (dois clientes diferentes podem ter usuários com o mesmo e-mail, ex.: contador que atende várias contas).
- Módulo `auth`: cadastro (`POST /auth/signup`, cria tenant + usuário admin em uma única chamada), login (`POST /auth/login`, retorna JWT com `sub`, `tenantId`, `role`), guard JWT, guard de RBAC (`@Roles(...)`), decorator `@CurrentUser()` para pegar o usuário autenticado em qualquer controller.
- Módulos `tenants` e `users`: services mínimos usados pelo `auth`.

**Como rodar localmente:**

```bash
cd apps/api
cp .env.example .env
docker compose -f ../../docker-compose.yml up -d      # sobe Postgres e Redis
npm install
npx prisma migrate dev --name init                     # cria as tabelas
npm run start:dev                                       # API em http://localhost:3000/api
```

**Como testar (exemplo com curl):**

```bash
# Criar conta (tenant + usuário admin)
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"tenantName":"Minha Loja","name":"Guilherme","email":"gssilvasantos@gmail.com","password":"senha-forte-123"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gssilvasantos@gmail.com","password":"senha-forte-123"}'

# Rota protegida (troque SEU_TOKEN pelo accessToken retornado no login)
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer SEU_TOKEN"
```

**Decisões técnicas que valem registrar:**
- Isolamento entre tenants hoje é feito por aplicação (todo repositório/serviço filtra por `tenantId` vindo do JWT). O PRD menciona Row-Level Security do Postgres como camada extra de defesa — fica como débito técnico consciente para uma etapa de hardening, não bloqueia o MVP.
- RBAC está simplificado a um enum de papéis (`ADMIN`, `PRICING_EDITOR`, `VIEWER`) em vez da tabela de permissões granulares do PRD. Suficiente para a fase 1; evolui para permissões por ação quando houver necessidade real (ex.: permissão específica para mexer em margem mínima).

## Etapa 2 — Módulo de Produto (SKU)

**O que foi implementado:**
- `prisma/schema.prisma`: modelos `Product`, `Supplier` e `TaxProfile`, todos com `tenantId` e isolamento por conta. `Product.skuCode` é único por tenant (`@@unique([tenantId, skuCode])`).
- **Peso cubado calculado automaticamente.** A pedido seu, o produto ganhou três campos que o sistema calcula sozinho a partir do que você preenche (peso, peso da embalagem, comprimento, largura, altura) — o cliente da API nunca envia esses três valores, eles são sempre recalculados no backend:
  - `packedWeightKg` = peso do produto + peso da embalagem.
  - `cubicWeightKg` = (comprimento × largura × altura) ÷ fator de cubagem (padrão **6000**, referência comum em transporte aéreo/Correios).
  - `shippingWeightKg` = o maior valor entre `packedWeightKg` e `cubicWeightKg`. **Esse é o campo que importa de verdade**: é o que Mercado Livre, Shopee etc. de fato usam para calcular/cobrar frete.
  - *(Nota: na Etapa 3 esse cálculo foi extraído para o módulo Logistics Intelligence — ver seção abaixo. O comportamento da API não mudou.)*
- **Dois campos de margem** (`desiredMarginPct`, `minimumMarginPct`), com validação no service: a margem mínima nunca pode ser maior que a desejada — é o piso, não a meta (PRD, seção 1.2).
- `Supplier` e `TaxProfile`: CRUDs simples e reutilizáveis entre produtos. `TaxProfile` guarda uma **alíquota estimada única** por perfil (ex.: "Simples Nacional — Anexo I") em vez de calcular ICMS-ST por estado ou faixa progressiva — simplificação consciente registrada no PRD (seção 9) como risco a revisitar.
- `ProductsController`: `POST/GET/PATCH/DELETE /products`, protegido por JWT + RBAC (`PRICING_EDITOR` ou `ADMIN` para criar/editar, só `ADMIN` para excluir — que na prática é soft delete, porque o produto vai ser referenciado por histórico de preço nas próximas etapas).

**Como testar:**

```bash
# Rodar os testes do cálculo de peso cubado
npm test

# Exemplo de criação de produto (troque SEU_TOKEN pelo token de /auth/login)
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "skuCode": "CAM-001",
    "name": "Camiseta Básica Branca P",
    "costPrice": 18.90,
    "desiredMarginPct": 25,
    "minimumMarginPct": 10,
    "weightKg": 0.18,
    "packagingWeightKg": 0.02,
    "lengthCm": 30,
    "widthCm": 25,
    "heightCm": 3
  }'
```

A resposta traz `packedWeightKg`, `cubicWeightKg` e `shippingWeightKg` já calculados — nenhum dos três foi enviado no payload.

## Etapa 3 — Arquitetura em camadas (DDD / Clean Architecture) + extração do Logistics Intelligence

Antes de construir o Marketplace Intelligence, revisamos a arquitetura para suportar a visão completa de plataforma (Dashboard, Produtos, Marketplace Intelligence, Pricing Intelligence, Competition Intelligence, Logistics Intelligence, Analytics, AI Intelligence, Configurações — ver `docs/platform-architecture.md`). Duas mudanças estruturais, sem alterar nenhum contrato de API já exposto:

**3.1 — Todo módulo passou a ter 4 camadas** (`domain/`, `application/`, `infrastructure/`, `interface/`), com dependência sempre apontando para dentro (interface → application → domain; infrastructure implementa portas que application define). `Identity & Access` (antes `auth`/`tenants`/`users`, três módulos soltos) virou um único módulo `identity-access`, porque os três eram sempre o mesmo bounded context. `Catalog` (antes `products`/`suppliers`/`tax-profiles`) virou um único módulo `catalog` pelo mesmo motivo.

**3.2 — Peso cubado saiu do Catalog e virou o módulo `logistics-intelligence`.** Peso e dimensões continuam sendo fatos do produto (Catalog é dono). Mas a fórmula que transforma esses fatos em peso de cobrança é uma **regra de negócio configurável** (o fator de cubagem), e isso pertence ao Logistics Intelligence — o mesmo raciocínio que já tínhamos aplicado ao Marketplace Intelligence para regras de comissão. `Tenant.cubicWeightFactor` virou `LogisticsSettings.cubicWeightFactor` (endpoints `GET/PUT /logistics-intelligence/settings`), e o Catalog agora pede o cálculo através de uma porta (`ShippingWeightCalculator`, definida em `shared/contracts/`) em vez de calcular sozinho. Isso não muda a resposta da API de produtos — é uma mudança interna de onde a responsabilidade mora.

**3.3 — Banco de dados organizado por schema Postgres** (`identity`, `catalog`, `logistics_intelligence`, via `multiSchema` do Prisma), adotado agora porque nenhuma migration real foi rodada ainda — o custo de reorganizar schemas depois da primeira migration é muito maior.

**Importante:** como nenhuma migration foi aplicada ainda neste ambiente (sandbox sem acesso de rede completo para `npm install`), este código não foi compilado/testado com `tsc`/`nest build` nesta sessão. Validei manualmente que todos os imports relativos resolvem para arquivos existentes (script Node percorrendo os 60 arquivos do projeto, zero import quebrado), mas recomendo rodar localmente antes de seguir:

```bash
cd apps/api
npm install
npm run build      # pega qualquer erro de tipo que a checagem manual não pega
npm test           # testes do cálculo de peso cubado devem continuar passando
npx prisma migrate dev --name init
npm run start:dev
curl -X POST http://localhost:3000/api/auth/signup -H "Content-Type: application/json" \
  -d '{"tenantName":"Minha Loja","name":"Guilherme","email":"gssilvasantos@gmail.com","password":"senha-forte-123"}'
```

Se `npm run build` apontar algum erro de tipo, me avise antes de seguirmos — é o tipo de coisa que vale corrigir antes de empilhar mais módulos em cima.

## Etapa 4 — Marketplace Intelligence (schema, orquestrador de sync, adaptador do Mercado Livre)

Implementação completa do desenho aprovado em `docs/marketplace-intelligence-architecture.md`. Novo módulo `modules/marketplace-intelligence/`, seguindo as mesmas 4 camadas dos demais.

**O que foi implementado:**

- **Schema Prisma** (`marketplace_intelligence`): `Marketplace` (tabela, não enum — adicionar canal novo é `INSERT`, nunca migration), `MarketplaceRule` (tabela única e versionada para qualquer tipo de regra — `FEE_RULE` hoje, `SHIPPING_POLICY`/`CATEGORY_TAXONOMY` quando algum provider precisar), `MarketplaceChangeEvent` (histórico que alimenta o painel), `ProviderSyncSchedule`/`ProviderSyncLog`/`ProviderHealth` (orquestração e observabilidade).
- **Contratos em `shared/contracts/`**: `marketplace-provider.contract.ts` (interfaces `MarketplaceProvider`/`FeeRuleCapableProvider`/etc., o formato que todo adaptador de marketplace implementa), `auth-strategy.contract.ts` (pronto para quando um provider precisar de OAuth — nenhum usa ainda), `fee-rule-resolver.port.ts` (a porta que o futuro Pricing Intelligence vai consumir — token `FEE_RULE_RESOLVER`).
- **Pipeline de sincronização** (`RuleSyncOrchestrator`): fetch → normaliza (valida payload por `ruleType`) → hash/diff contra a última versão `VALIDADA` → decide (pendente ou auto-validada, conforme `autoTrust` do schedule) → persiste versão nova → registra `MarketplaceChangeEvent` → emite evento de domínio. Inclui retry com backoff exponencial e resiliência parcial (um candidato malformado não derruba o lote).
- **Governança** (`MarketplaceRulesAdminService` + `MarketplaceRulesAdminController`): listar pendências, aprovar, rejeitar, pin/unpin, cadastro manual — tudo mapeado nos endpoints `POST /marketplace-intelligence/rules/*`.
- **Painel** (`MarketplaceChangeEventsController`): `GET /marketplace-intelligence/change-events` — o histórico de alterações por marketplace.
- **Cache com invalidação ativa** (`RuleRegistryService`): implementação em memória por enquanto (processo único) — vira Redis sem tocar em quem consome, porque tudo passa pela porta `FeeRuleResolver`. Invalida na hora quando uma regra é validada (evento `marketplace-rule.validated`), não espera o TTL vencer.
- **Scheduler** (`SyncSchedulerJob`, `@nestjs/schedule`): roda a cada 5 minutos, dispara sync só para os providers vencidos conforme `ProviderSyncSchedule.intervalMinutes`.
- **Adaptador funcional do Mercado Livre** (`MercadoLivreFeeRuleProvider`): busca categorias e comissão via os endpoints públicos `GET /sites/MLB/categories` e `GET /sites/MLB/listing_prices` (não exigem OAuth — por isso este provider não implementa `AuthenticatedProvider` ainda). **Ressalva importante:** não consegui validar o formato exato da resposta contra uma chamada ao vivo neste ambiente (sem acesso de rede completo); o mapeamento em `mercado-livre-api.client.ts` segue a documentação pública, mas o `RulePayloadValidator` do domínio rejeita e loga qualquer resposta fora do formato esperado em vez de persistir algo incerto — teste isso com atenção ao rodar localmente.
- **Decisão já confirmada com você**: todo candidato nasce `PENDENTE_VALIDACAO` (`autoTrust: false` no seed) — nada é aplicado automaticamente ainda, nem vindo da API oficial.
- **Seed** (`prisma/seed.ts`): cadastra os 6 marketplaces (só Mercado Livre com provider funcional) e o `ProviderSyncSchedule` do Mercado Livre (diário).

**Novas dependências:** `@nestjs/event-emitter` (eventos de domínio in-process) e `@nestjs/schedule` (o job de sincronização). Rode `npm install` de novo antes do build.

**Como testar:**

```bash
cd apps/api
npm install
npx prisma migrate dev --name marketplace_intelligence
npx prisma db seed
npm run build
npm run start:dev

# Ver os providers registrados
curl http://localhost:3000/api/marketplace-intelligence/providers -H "Authorization: Bearer SEU_TOKEN"

# Disparar sincronização do Mercado Livre manualmente ("verificar agora")
curl -X POST http://localhost:3000/api/marketplace-intelligence/providers/MERCADO_LIVRE_API_V1/sync \
  -H "Authorization: Bearer SEU_TOKEN"

# Ver o que ficou pendente de aprovação
curl http://localhost:3000/api/marketplace-intelligence/rules/pending -H "Authorization: Bearer SEU_TOKEN"

# Aprovar uma regra (troque RULE_ID pelo id retornado acima)
curl -X POST http://localhost:3000/api/marketplace-intelligence/rules/RULE_ID/approve \
  -H "Authorization: Bearer SEU_TOKEN"

# Ver o histórico de mudanças (o painel)
curl http://localhost:3000/api/marketplace-intelligence/change-events -H "Authorization: Bearer SEU_TOKEN"
```

**Simplificações conscientes desta etapa** (registradas para não virarem surpresa depois):
- Comissão capturada num único preço de referência (R$100) por categoria de primeiro nível — granularidade completa (subcategorias × faixas de preço) é iteração futura, a arquitetura já suporta via `scopeKey` mais específico.
- Cache do `FeeRuleResolver` em memória, não Redis — troca é local a uma classe quando a plataforma escalar horizontalmente.
- Scheduler via `@nestjs/schedule` (cron simples), não BullMQ — suficiente para 1 provider; BullMQ entra quando o número de providers/marketplaces justificar filas com retry distribuído.
- `MercadoLivreFeeRuleProvider` não testado contra API ao vivo nesta sessão — validar no primeiro `npm run start:dev` local.

**Próxima etapa (aguardando sua confirmação):** Pricing Intelligence — o motor que consome `FeeRuleResolver` (Marketplace Intelligence) + `ShippingWeightCalculator` (Logistics Intelligence) + o produto (Catalog) para calcular preço ideal, preço mínimo, margem e lucro por SKU × marketplace.

*(Nota de continuidade: antes de seguir para Pricing Intelligence ou para o front-end, você pediu para dar um passo atrás e construir a integração com o Olist ERP primeiro — ver Etapa 5 abaixo.)*

## Etapa 5 — ERP Integration (Olist Tiny como fonte única da verdade do catálogo)

Implementação completa do desenho aprovado em `docs/erp-integration-architecture.md`. Novo módulo `modules/erp-integration/`, seguindo as mesmas 4 camadas dos demais. Objetivo: o Olist deixa de ser "mais uma integração" e vira a fonte de cadastro do catálogo — o usuário não cadastra produto manualmente, o Precifica importa e mantém sincronizado.

**O que foi implementado:**

- **Schema Prisma**: `Product` (schema `catalog`) ganhou `stockQuantity`, `erpSalePrice`, `photoUrls`, `sourceSystem` (`MANUAL` | `ERP_OLIST`), `externalId`, `lastSyncedAt` — e uma regra nova: campos físicos/comerciais de um produto `ERP_OLIST` só mudam no próximo sync, `PATCH /products/:id` rejeita tentativa de editá-los manualmente. `CatalogSettings` (schema `catalog`): margem padrão para produto recém-importado (**20% desejada / 8% mínima**, confirmado com você), configurável por tenant. `OlistConnection`/`ErpSyncChangeEvent` (schema novo `erp_integration`): credencial por tenant e o último estado sincronizado de cada produto.
- **Extração para `integration_ops`**: `ProviderSyncSchedule`/`ProviderSyncLog`/`ProviderHealth` saíram do schema `marketplace_intelligence` para um schema compartilhado `integration_ops` — o ERP Integration precisa exatamente do mesmo mecanismo de agenda/log/saúde, e duplicar essas três tabelas seria quebrar DRY por acidente de organização de pastas. `shared/sync-ops/` é o módulo Nest que expõe esses repositórios; Marketplace Intelligence e ERP Integration importam o mesmo módulo. Nenhum comportamento do Marketplace Intelligence mudou — só o endereço das tabelas. `computeContentHash` também foi promovido de `marketplace-intelligence/domain/` para `shared/domain/`, pelo mesmo motivo.
- **`ProductCatalogWriter`** (`shared/contracts/product-catalog-writer.port.ts`): a porta que o Catalog expõe (não consome) para o ERP Integration escrever produtos — direção inversa do `ShippingWeightCalculator` (lá o Catalog consome do Logistics Intelligence; aqui o Catalog é consumido). Implementada por `CatalogSyncWriterService`: cria produto novo com a margem padrão do `CatalogSettings`, atualiza produto existente preservando margem/fornecedor/perfil fiscal/categoria (que continuam sendo configuração da Precifica, nunca do ERP).
- **Fotos espelhadas de verdade** (decisão confirmada com você, contra minha recomendação inicial de só guardar a URL): `FileStorage` (`shared/contracts/file-storage.port.ts`) é a porta; `LocalFileStorageService` é a implementação — baixa cada foto do Olist (GET, mesma garantia de leitura) e grava em disco local, servido como estático em `/uploads/*` (`ServeStaticModule`). Trocável por S3/R2/GCS depois trocando um único binding, sem tocar em quem consome. `ProductPhotoMirrorService` cuida do download com resiliência parcial (uma foto que falha não derruba o produto inteiro).
- **`OlistApiClient`**: implementado contra a **API V2** do Tiny/Olist (token estático por conta), não a V3/OAuth2 — decisão técnica registrada na seção 8 do doc de arquitetura (V3 exige plano "Construa" e endpoints que não consegui validar ao vivo neste ambiente). Só métodos GET existem no código — `produtos.pesquisa.php` (lista paginada) e `produto.obter.php` (detalhe completo, com peso/dimensão/fotos). **Ressalva importante, mesmo padrão da Etapa 4:** não consegui validar os nomes exatos de campo (`peso_liquido`, `anexos`, etc.) contra uma resposta real e autenticada neste ambiente — o normalizador (`domain/olist-product-normalizer.ts`) rejeita e loga qualquer produto com dado ausente/incoerente em vez de importar algo errado. Confira os logs de warning no primeiro sync real.
- **Credenciais criptografadas em repouso**: `CredentialEncryptionService` (`shared/security/`, AES-256-GCM) — chave vem de `ERP_CREDENTIALS_ENCRYPTION_KEY` (env var, defina um valor forte antes de produção; sem ela, usa uma chave de dev e avisa no log).
- **Pipeline de sync** (`ErpSyncOrchestrator`): por tenant (cada conta tem seu próprio token Olist, diferente do Marketplace Intelligence onde 1 provider atende todos os tenants) — fetch → normaliza → hash do payload original (antes de espelhar foto, para não rebaixar imagem à toa) vs. último `ErpSyncChangeEvent` → se igual, não faz nada → se diferente, espelha fotos → `ProductCatalogWriter.upsertFromExternalSource` → grava `ErpSyncChangeEvent`. **Diferença de governança da Etapa 4, deliberada:** aqui não existe `PENDENTE_VALIDACAO` — aplica direto, porque o Olist é, por definição sua, a fonte única da verdade (exigir aprovação manual por SKU importado contradiria "não quero cadastrar produto manualmente").
- **Endpoints** (`OlistConnectionController`, só `ADMIN` conecta/desconecta):
  - `GET /erp-integration/olist/status`
  - `POST /erp-integration/olist/connect` `{ "apiToken": "..." }` — valida contra a API antes de salvar
  - `DELETE /erp-integration/olist/connect`
  - `POST /erp-integration/olist/sync-now` — dispara sync imediato, sem esperar o scheduler
  - `GET /erp-integration/olist/change-events`
  - `GET /catalog/settings` / `PUT /catalog/settings` — margem padrão do tenant

**Novas dependências:** `@nestjs/serve-static` (serve as fotos espelhadas). Rode `npm install` de novo antes do build.

**Como testar:**

```bash
cd apps/api
npm install
npx prisma migrate dev --name erp_integration
npx prisma db seed
npm run build
npm run start:dev

# Conectar sua conta do Olist (gere o token em Configurações > Preferências > Chave da API)
curl -X POST http://localhost:3000/api/erp-integration/olist/connect \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"apiToken":"SEU_TOKEN_OLIST"}'

# Disparar a primeira importação sem esperar o scheduler (roda a cada 30 min)
curl -X POST http://localhost:3000/api/erp-integration/olist/sync-now -H "Authorization: Bearer SEU_TOKEN"

# Ver o que foi importado/atualizado
curl http://localhost:3000/api/erp-integration/olist/change-events -H "Authorization: Bearer SEU_TOKEN"

# Conferir que os produtos apareceram no Catalog, já com sourceSystem ERP_OLIST
curl http://localhost:3000/api/products -H "Authorization: Bearer SEU_TOKEN"

# Tentar editar um campo espelhado de um produto ERP_OLIST — deve retornar 400
curl -X PATCH http://localhost:3000/api/products/PRODUCT_ID \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"costPrice": 99}'
```

**Simplificações conscientes desta etapa:**
- API V2 do Olist (token estático), não V3/OAuth2 — migração é natural quando os endpoints puderem ser validados contra uma conta real; ver seção 8 do doc de arquitetura.
- Intervalo de sync único e global (`ProviderSyncSchedule`, hoje 60 min) para todos os tenants, não configurável por conta ainda — due-check individual usa `OlistConnection.lastSyncedAt`, então nenhum tenant é bloqueado pelo outro, só compartilham a mesma cadência.
- `ErpSyncChangeEvent` guarda o **último estado conhecido** por produto (upsert por `tenantId + externalId`), não um log append-only como o `MarketplaceChangeEvent` — histórico completo de mudanças fica para uma iteração futura, se a auditoria exigir mais que o snapshot mais recente.
- Renomear o SKU no Olist não propaga para o Precifica nesta versão — o vínculo de identidade é por `externalId`, então o produto certo continua sendo atualizado, só o campo `skuCode` fica desatualizado até uma correção manual futura.
- Chave de criptografia de credenciais vem de env var, não de um KMS gerenciado — troca é um adapter (`CredentialEncryptionService`), não uma reescrita, quando isso for necessário.
- Vínculo por SKU com anúncios do Mercado Livre/Shopee (para a inteligência de preço cruzar ERP × marketplace) ainda **não existe** — precisa de um conceito `ChannelListing` que é o próximo módulo natural depois deste.

### Etapa 5.1 — Nuvemshop (canal de venda próprio) + primeira fatia do Pricing Intelligence

Você pediu, no meio desta mesma etapa, para incluir a Nuvemshop no escopo: ela é a loja própria do negócio, e a margem lá precisa do mesmo rigor dos marketplaces — só que com uma taxa de gateway (Nuvem Pago) que varia por parcelamento e janela de recebimento, em vez de uma comissão fixa por categoria.

**Uma decisão de arquitetura que vale registrar antes do resto:** a Nuvemshop entrou nos endpoints deste módulo (`erp-integration`), como você pediu, mas **não é um ERP** — é um canal de venda, estruturalmente igual a Mercado Livre/Shopee. Por isso, internamente, ela não reaproveita o pipeline read-only do Olist: a taxa de gateway (dado que varia, precisa de versionamento e aprovação) entra pela mesma esteira do Marketplace Intelligence — `MarketplaceRule`, `RuleSyncOrchestrator`, governança `PENDENTE_VALIDACAO` — e não pelo `ProductCatalogWriter` do Olist. Isso evitou construir um segundo mecanismo de versionamento/cache do zero só porque o nome do canal é diferente.

**O que foi implementado:**

- **`ChannelListing`** (schema novo `channel_integration`): o vínculo por SKU pedido no requisito 4 — uma linha por (produto, canal), preenchida pela sincronização de cada canal. Hoje só a Nuvemshop popula (via SKU da variante); Mercado Livre/Shopee entram no mesmo modelo quando tiverem adaptador de listagem.
- **`NuvemshopConnection`** (schema `erp_integration`, ao lado do `OlistConnection`): credencial por tenant (storeId + access_token de "app privado" da Nuvemshop) — mesma categoria de decisão do Olist V2: evitei montar um fluxo OAuth2 completo sem poder validar os endpoints exatos ao vivo neste ambiente.
- **`NuvemshopChannelListingSyncService`**: lê os produtos/variantes da Nuvemshop (API pública, `GET /v1/{store_id}/products`) e faz upsert em `ChannelListing` casando pelo campo `sku` de cada variante — o vínculo do requisito 4. Roda a cada 30 min (`NuvemshopSyncSchedulerJob`), due-check por `NuvemshopConnection.lastSyncedAt`, mesmo padrão do `ErpSyncSchedulerJob`.
- **`NuvemshopFeeRuleProvider`** (`modules/erp-integration/infrastructure/nuvemshop/`, mas registrado no `MARKETPLACE_PROVIDERS` do Marketplace Intelligence): implementa `FeeRuleCapableProvider`, igual ao `MercadoLivreFeeRuleProvider`. `scopeKey` é a combinação `{parcelas}x_{diasRecebimento}d` (ex.: `3x_14d`) — o requisito de "taxa varia por parcelamento e janela de recebimento" virou, literalmente, o campo que o `FeeRuleResolver` já usava para categoria do Mercado Livre. **Diferença estrutural nova:** este é o primeiro provider *por tenant* (cada loja tem seu próprio contrato de gateway, não é dado público) — isso obrigou a estender `RuleSyncOrchestrator.syncFeeRules` para reconhecer providers que implementam `listTenantIdsToSync()` e sincronizar uma vez por tenant, gerando `MarketplaceRule` com `tenantId` preenchido (nunca `null`). O comportamento do Mercado Livre (provider global) não mudou — ele simplesmente não implementa esse método opcional.
- **Ressalva de honestidade, mais forte que as anteriores:** não tenho confiança de que a Nuvemshop exponha publicamente, via API, a tabela de taxas do Nuvem Pago por parcela/janela de recebimento — é o tipo de dado que costuma existir só no painel do lojista. `fetchGatewayFeeTable` tenta um endpoint plausível e, se vier vazio ou em formato não reconhecido, loga isso claramente e **não quebra o sync**. Nesse caso, o caminho é cadastrar a tabela manualmente — o endpoint `POST /marketplace-intelligence/rules/manual` (da Etapa 4) já serve exatamente para isso, e o resto do pipeline (versionamento, cache, resolução, simulador) funciona de forma idêntica não importa se a regra chegou pela API ou por cadastro manual.
- **Primeira fatia do Pricing Intelligence** (`modules/pricing-intelligence/`, novo módulo): o simulador de margem líquida pedido no requisito 3. Consome três portas — `PRODUCT_CATALOG_READER` (Catalog, novo — irmã de leitura do `ProductCatalogWriter`), `CHANNEL_LISTING_READER` (erp-integration) e `FEE_RULE_RESOLVER` (Marketplace Intelligence) — exatamente as três que o `platform-architecture.md` já previa para o motor de preço completo. Isso é uma fatia inicial pedida por você, não o motor de preço ideal/mínimo do PRD original — fica registrado para não virar confusão de escopo depois.
  - `POST /pricing-intelligence/nuvemshop/simulate` `{ skuCode, installments, receivingWindowDays, freeShipping?, estimatedShippingCost?, couponCost? }` → devolve preço bruto, taxa de gateway aplicada, dedução de frete (se `freeShipping`), dedução de cupom, margem líquida em R$ e em %. Cálculo puro e testável em `domain/nuvemshop-margin-calculator.ts`.

**Endpoints novos desta subseção:**

```bash
# Conectar a loja (gere o token em Configurações > Meus Aplicativos > Criar app privado)
curl -X POST http://localhost:3000/api/erp-integration/nuvemshop/connect \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"storeId":"SEU_STORE_ID","accessToken":"SEU_ACCESS_TOKEN"}'

# Vincular os SKUs (roda o sync de listings imediatamente)
curl -X POST http://localhost:3000/api/erp-integration/nuvemshop/sync-now -H "Authorization: Bearer SEU_TOKEN"

# Ver os vínculos SKU x Nuvemshop
curl http://localhost:3000/api/erp-integration/channel-listings -H "Authorization: Bearer SEU_TOKEN"

# Se a API não trouxe a tabela de taxas do gateway, cadastre manualmente (endpoint já existe desde a Etapa 4)
curl -X POST http://localhost:3000/api/marketplace-intelligence/rules/manual \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"marketplaceCode":"NUVEMSHOP","ruleType":"FEE_RULE","scopeKey":"3x_14d","payload":{"commissionPct":4.5,"fixedFeeAmount":0}}'

# Aprovar a regra cadastrada (troque RULE_ID pelo id retornado acima)
curl -X POST http://localhost:3000/api/marketplace-intelligence/rules/RULE_ID/approve -H "Authorization: Bearer SEU_TOKEN"

# Simular a margem líquida com parcelamento absorvido e frete grátis
curl -X POST http://localhost:3000/api/pricing-intelligence/nuvemshop/simulate \
  -H "Authorization: Bearer SEU_TOKEN" -H "Content-Type: application/json" \
  -d '{"skuCode":"CAM-001","installments":3,"receivingWindowDays":14,"freeShipping":true,"estimatedShippingCost":18.90}'
```

**Simplificações conscientes desta subseção:**
- Nuvemshop conectada via "app privado" (storeId + token estático), não o fluxo OAuth2 completo de app público — mesma categoria de decisão do Olist V2.
- Tabela de taxas do gateway via API é best-effort, não garantida — cadastro manual é o caminho esperado até validar contra uma conta real.
- Intervalo de sync de listings global (30 min de due-check, mesmo padrão do ERP), não configurável por tenant ainda.
- O simulador não persiste nenhum cenário simulado — é uma calculadora sob demanda, sem histórico. Guardar simulações/comparar cenários lado a lado é evolução natural quando o Pricing Intelligence completo for construído.
- Ainda não existe push de preço de volta para a Nuvemshop — `NuvemshopApiClient` é GET-only, igual ao do Olist, porque nada pediu escrita ainda.

**Próxima etapa (aguardando sua confirmação):** com Olist + Nuvemshop + o primeiro cálculo de margem no ar, os caminhos naturais são: (a) vincular Mercado Livre/Shopee ao mesmo `ChannelListing` para o simulador cobrir todos os canais, (b) expandir a primeira fatia do Pricing Intelligence para o motor completo do PRD (preço ideal/mínimo por SKU × marketplace, não só o simulador da Nuvemshop), ou (c) a decisão de stack/direção visual do front-end que segue em aberto. Qual prefere seguir primeiro?

*(Nota de continuidade: você respondeu — stack confirmada React + Vite + TypeScript, e a direção visual também foi fechada. Ver Etapa 6 abaixo.)*

## Etapa 6 — Frontend (React + Vite + TypeScript): primeira tela, precificação por produto

Novo `apps/web/`, monorepo com o backend (`apps/api/`). Stack: React 18 + Vite + TypeScript, Tailwind (design system customizado), React Router (rotas), TanStack React Query (estado de servidor — cache/refetch das chamadas à API), Axios (cliente HTTP com o JWT já no header).

**Direção visual que você fechou** (Tailwind `theme.extend` em `tailwind.config.js`):
- Fundo claro/neutro (`canvas` `#F8F9FA`, cards em branco) para não competir com foto de produto.
- Tipografia dupla: **Playfair Display** (serifada) para títulos/nome de produto — `font-serif`, aplicada automaticamente em `h1`/`h2`/`h3` via `src/styles/index.css`; **Inter** (sans densa) para números, SKU e dado tabular — `font-sans`, fonte padrão do body.
- **Barra de margem "semáforo"** (`features/pricing/MarginBar.tsx`): vermelho `<10%`, amarelo `10–25%`, verde `>25%` — cor calculada a partir do `netMarginPct`, não fixa.
- **Destaque dourado** (`features/pricing/ProductPricingCard.tsx`): o card do canal com melhor margem ganha borda com glow dourado pulsante (`animate-goldPulse`, keyframe em `tailwind.config.js`) e um badge "Melhor margem".
- Identidade de canal: círculo colorido com a cor de referência de cada marca (Nuvemshop, Mercado Livre, Shopee) — **aproximação visual**, não validada contra guideline de marca oficial; troque por logo real (`<img>`) quando tiver os arquivos.

**Primeira tela: Precificação por Produto** (`routes/ProductPricingPage.tsx`), a pedido seu — não a tela de Integrações que eu tinha sugerido inicialmente. Fluxo: lista de produtos à esquerda (dados reais de `GET /products`) → seleciona um → grid com um card por canal (Nuvemshop, Mercado Livre, Shopee) mostrando preço, custo, taxa aplicada e margem.

**Importante, para não fingir dado que não existe:** hoje só a **Nuvemshop** tem os dois lados prontos no backend (vínculo de SKU via `ChannelListing` + taxa de gateway via `FeeRuleResolver`) — o card dela chama de verdade `POST /pricing-intelligence/nuvemshop/simulate`, com controles reais de cenário (parcelas, janela de recebimento, frete grátis, cupom) que você pediu. Mercado Livre e Shopee aparecem no grid (a visão por produto sempre mostra todos os canais relevantes), mas como **"Aguardando integração"** — sem número inventado — porque nenhum adaptador ainda sincroniza `ChannelListing` para eles. Isso resolve sozinho quando esses adaptadores existirem (é um próximo passo já mapeado no backlog).

**Autenticação:** `features/auth/auth-context.tsx` guarda `accessToken` + usuário em `localStorage`, injeta o Bearer token em toda chamada via interceptor do Axios (`lib/api-client.ts`). `ProtectedRoute` redireciona para `/login` se não autenticado. Login usa `POST /auth/login` (backend já existente desde a Etapa 1) — não criei tela de signup ainda (crie a conta via curl, como nas etapas anteriores, ou peça que eu adicione a tela).

**Como rodar:**

```bash
# Terminal 1 — backend (se ainda não estiver rodando)
cd apps/api
npm run start:dev

# Terminal 2 — frontend
cd apps/web
npm install
npm run dev      # abre em http://localhost:5173
```

Faça login com um usuário já criado (`POST /auth/signup` via curl, ver Etapa 1) — a tela de login está em `/login`, redireciona para `/produtos` depois de autenticar.

**Simplificações conscientes desta etapa:**
- Sem tela de signup (só login) — criar conta continua via curl por enquanto.
- Logos dos canais são círculos coloridos com iniciais, não os logos reais — troca simples quando tiver os arquivos de marca licenciados.
- Simulador só considera Nuvemshop (o único canal com `ChannelListing` + taxa real hoje) — ML/Shopee entram no mesmo grid assim que tiverem adaptador de listagem.
- Sem paginação/busca na lista de produtos — ok para o catálogo de teste, vira necessário com volume real.
- `noUnusedLocals`/`noUnusedParameters` desligados no `tsconfig.json` do frontend para reduzir atrito nesta fase inicial — reative quando o time crescer e quiser lint mais rígido.

**Próxima etapa (aguardando sua confirmação):** tela de Integrações (conectar Olist/Nuvemshop, ver status e disparar sync manualmente pela UI em vez de curl) é o complemento natural desta tela — hoje isso só existe via API. Também dá para seguir por telas de Marketplace Intelligence (aprovar regras pendentes) ou Analytics. Qual prefere?

### Etapa 6.1 — Conta demo (seed) + atalho de login para testar sem depender de Olist/Nuvemshop reais

Você pediu um jeito de pular a tela de login com um token falso para testar os cards mais rápido. Implementei diferente do pedido literal, por um motivo técnico: um token de verdade falso (qualquer string salva no `localStorage`) é rejeitado pelo `JwtAuthGuard` na primeira chamada protegida — a tela de produtos apareceria vazia/quebrada, pior do que só digitar a senha. Em vez disso:

- **`prisma/seed-demo.ts`** (novo, separado do `prisma/seed.ts` de plataforma): cria uma conta completa pronta pra usar — tenant "Loja Demo", usuário `demo@precifica.dev` / `demo12345678`, 3 produtos manuais com custo calibrado pra cair um em cada faixa do semáforo (verde ~36%, amarelo ~18%, vermelho ~6%), `ChannelListing` da Nuvemshop pra cada um (preço R$ 100) e as regras de taxa de gateway **já validadas** (`MarketplaceRule` com `status: VALIDADA`, várias combinações de parcela × janela de recebimento) — isso é o que permite o simulador funcionar sem nenhuma conexão real com Nuvemshop/Olist, porque a regra já está lá, não depende de sync.
  ```bash
  cd apps/api
  npm run prisma:seed:demo
  ```
- **Botão "Entrar com conta demo"** na tela de login (`LoginPage.tsx`, só aparece em modo dev via `import.meta.env.DEV`): faz um login de verdade com essas credenciais — um clique, sem digitar nada, e a lista de produtos já vem preenchida com o semáforo e o glow dourado no card de melhor margem.

Isso também resolve, de outro ângulo, o "Failed to connect" do seu `curl`: se o navegador (via Vite) também não conseguir falar com `localhost:3000/api`, o problema é de rede/porta, não de autenticação — nesse caso confira se o backend está realmente respondendo em `http://localhost:3000/api/auth/me` no navegador antes de tentar de novo.

## Etapa 7 — Navegação profissional (Sidebar) + Catálogo (listagem de produtos)

A tela única de precificação virou o começo de um ecossistema de telas. Mudanças em `apps/web`:

- **`components/Sidebar.tsx`**: sidebar persistente no desktop, deslizante (com backdrop) no mobile — sem lib nova, só Tailwind + estado local no `AppLayout`. 4 seções: Dashboard, Produtos, Integrações, Configurações Fiscais.
- **`routes/CatalogPage.tsx`** (nova tela principal, em `/catalogo`): lista todo o catálogo — foto, nome, SKU, custo, preço de venda médio, margem média e um badge de status (Margem saudável / Margem baixa / Prejuízo / Sem canal vinculado), com botão "Editar Precificação" que leva para a tela de detalhe (`/produtos/:id`).
- **Duas decisões de cálculo que valem registrar** (`features/catalog/margin-status.ts`):
  1. Preço/margem da listagem são uma **média simples entre canais vinculados, sem taxa de gateway** — rápido de calcular pra muitas linhas de uma vez. O cálculo fino (com taxa por parcela/janela de recebimento) continua só na tela de detalhe, que já chama o simulador de verdade. Deixei isso explícito na própria tela pra não parecer que os dois números deveriam bater.
  2. O piso do status "Margem baixa" usa o `minimumMarginPct` **do próprio produto**, não uma porcentagem fixa igual para todo mundo — é exatamente pra isso que esse campo existe desde a Etapa 2 (o piso de segurança configurável por SKU do PRD).
- **`routes/ProductPricingPage.tsx`** ganhou `:productId` na URL (antes só guardava a seleção em estado local) — o link "Editar Precificação" agora é compartilhável/atualizável com F5, e a tela sempre normaliza a URL para o produto exibido.
- **Dashboard, Integrações e Configurações Fiscais** ganharam telas placeholder honestas (`components/ComingSoonPage.tsx`) em vez de 404 — cada uma explica o que já existe no backend (ex.: Integrações já funciona via curl, Configurações Fiscais já tem `TaxProfile`/`CatalogSettings` prontos) e o que falta é só a tela.

**Simplificação consciente:** a tabela do catálogo é responsiva por scroll horizontal (`overflow-x-auto`), não um layout de cards dedicado para mobile — funcional, mas vale revisitar se o uso em celular crescer.

**Próxima etapa (aguardando sua confirmação):** a tela de Integrações é o próximo candidato natural (conectar Olist/Nuvemshop, ver status, disparar sync pela UI) — hoje é o único item do menu sem nenhuma ação real por trás.

## Etapa 8 — Marketplace Intelligence: lado de escrita (repricing) desacoplado do canal

Você pediu para formalizar a arquitetura de Providers para que o Pricing Engine mande "atualize o preço para X" sem saber se o canal é Mercado Livre, Shopee ou Nuvemshop. Boa parte já existia desde a Etapa 4 (`MarketplaceProvider`, `MarketplaceProviderRegistry`, `FeeRuleResolver` — o "getCommissionRate" já é esse pipeline, versionado e com governança; não dupliquei). O que faltava de verdade era o **lado de escrita**, que é novo nesta etapa:

- **`ListingCapableProvider`/`PriceUpdateCapableProvider`** (novas interfaces em `shared/contracts/marketplace-provider.contract.ts`, Interface Segregation — mesmo padrão de `FeeRuleCapableProvider`): `listActiveListings()` e `updatePrice()`, cada provider implementa só o que sabe fazer.
- **`PriceUpdateDispatcher`** (`shared/contracts/price-update-dispatcher.port.ts`, implementado por `PriceUpdateDispatcherService` em `marketplace-intelligence/application/`): a porta única que o Pricing Engine vai chamar — `dispatch({ tenantId, marketplaceCode, skuCode, externalId, newPrice })` — sem importar nenhum provider concreto. Canal sem suporte a escrita retorna `{ success: false }`, não lança exceção (repricing em lote precisa disso).
- **`MercadoLivreFeeRuleProvider`** ganhou os dois métodos novos como **estrutura, não chamada real** — mesma honestidade da Etapa 4: a API do Mercado Livre exige OAuth2 por vendedor para essas duas operações (diferente dos endpoints públicos já usados para taxa), então eles lançam `NotImplementedException` com uma mensagem clara em vez de fingir que funcionam. `AuthenticatedProvider` (definido desde a Etapa 4, sem uso até agora) finalmente tem um motivo de existir.

**Onde tudo mora** (DDD — nada saiu do bounded context `marketplace_intelligence`):
```
shared/contracts/
  marketplace-provider.contract.ts   # + ListingCapableProvider, PriceUpdateCapableProvider
  price-update-dispatcher.port.ts    # novo — a porta que o Pricing Engine consome
modules/marketplace-intelligence/
  application/
    marketplace-provider-registry.service.ts  # + findPriceUpdateProvider()
    price-update-dispatcher.service.ts         # novo
  infrastructure/providers/mercado-livre/
    mercado-livre-fee-rule.provider.ts  # + listActiveListings/updatePrice (stub, OAuth pendente)
```

**Adicionar um canal novo com suporte a escrita** continua sendo só um arquivo novo implementando `PriceUpdateCapableProvider` + uma linha no factory do `MARKETPLACE_PROVIDERS` — nenhuma mudança em `PriceUpdateDispatcherService` nem no futuro Pricing Engine (receita completa na seção 12 de `docs/marketplace-intelligence-architecture.md`, atualizada com o lado de escrita na seção 14).

**Simplificação consciente:** nenhum controller HTTP expõe `PriceUpdateDispatcher` ainda — não existe consumidor real (o simulador da Nuvemshop só calcula, não aplica preço). Fica pronto para quando o motor de repricing automático (ou um botão "Aplicar preço" na UI) existir.

## Sprint 23 — Fase de Conexão Real e Interface de Operação

**Nota sobre este README:** o registro corrido abaixo da Etapa 8 não está mais sincronizado neste arquivo com as etapas seguintes já implementadas no código (Etapas 9–22, incluindo Financial Intelligence, Orders multicanal, OAuth2 do Mercado Livre e o Audit Mode) — a arquitetura de cada uma dessas etapas está documentada em `docs/*.md` (ver `docs/platform-architecture.md`, `docs/orders-architecture.md`, `docs/financial-intelligence-architecture.md`, `docs/auth-security.md`, `docs/audit-mode.md`). Esta seção documenta apenas a sprint mais recente; ver `docs/production-connection-observability.md` para o detalhe completo.

Você pediu para avançar para a Fase de Conexão Real: (1) validar a conexão de produção do Mercado Livre de ponta a ponta, (2) uma camada de observabilidade básica para falhas de sync/renovação de token, e (3) as duas primeiras telas de frontend a consumir dado real (Conexão + DRE por pedido).

- **`shared/observability/`** — `AlertService`/`ConsoleAlertService`, porta+adapter para alerta técnico (log grepável `[ALERTA TÉCNICO]`). Consumido por `OrderSyncOrchestrator` (falha por pedido = `WARNING`, falha do provider inteiro = `ERROR`) e por `MercadoLivreConnectionService` (falha ao renovar token = `ERROR`).
- **`MercadoLivreHandshakeService`** (novo, `marketplace-intelligence/application/`) — diagnóstico **read-only** de conexão: status → renovação automática de token → `fetchOrders` real, sem persistir nenhum `Order`. Endpoint `POST /marketplace-intelligence/mercado-livre/test-connection` (JWT, ADMIN). Deliberadamente separado do pipeline de ingestão real (`OrderSyncOrchestrator`) — ver seção 2 do doc da sprint para o racional completo.
- **`DreReport.orderLines`** (extensão aditiva de `financial-intelligence/domain/dre-report.ts`) — uma linha por pedido reconhecido no período (Pedido, Valor Total, Taxas, CMV, Margem Líquida), mesma fórmula de waterfall do agregado por canal, sem endpoint novo (`GET /financial-intelligence/dre` já devolve o campo).
- **Frontend:** `routes/IntegracoesPage.tsx` (conexão real com Mercado Livre — autorizar/status/testar/desconectar) e `routes/FinanceiroPage.tsx` (novo, rota `/financeiro` — tabela de DRE por pedido).

**Gap honesto:** o handshake de produção real (credenciais + conta de vendedor de verdade) não pôde ser validado a partir deste ambiente de desenvolvimento (sandbox sem acesso de rede externo) — precisa ser executado uma vez implantado. Observabilidade continua sendo só log estruturado, sem APM/notificação ativa. Ver `docs/production-connection-observability.md`, seção 5, para a lista completa.

## Etapa 9 — Teste de integração do `PriceUpdateDispatcher` ("prova de falhas" antes de Competition Intelligence)

Você pediu uma "garantia de qualidade" para o Dispatcher antes de seguir para o próximo módulo: um teste que prove que nenhum canal — registrado, não registrado, sem suporte a escrita, ou com erro de infraestrutura — consegue derrubar um repricing em lote com exceção não tratada.

**Achado técnico, corrigido nesta etapa:** ao preparar o teste, encontrei que `apps/api/package.json` não tinha nenhum bloco `"jest"` configurado (nem `jest.config.js` em lugar nenhum do repo), apesar de `ts-jest`/`@nestjs/testing` já estarem nas dependências. Sem esse bloco o Jest não sabe transformar `.ts` com decorators do NestJS, e nada baseado em `Test.createTestingModule` conseguiria rodar. Adicionei o bloco `jest` padrão (`transform` via `ts-jest`, `testRegex`, `rootDir: src`) — é uma correção real de um gap que já existia, não uma mudança de comportamento.

**Novo teste:** `apps/api/src/modules/marketplace-intelligence/application/price-update-dispatcher.integration.spec.ts` — teste de integração de verdade (`Test.createTestingModule` monta o DI real entre `MarketplaceProviderRegistry` e `PriceUpdateDispatcherService`; só o provider concreto é um dublê). 4 cenários:
1. Sucesso — provider certo é encontrado e `updatePrice()` é chamado com os parâmetros corretos.
2. Proteção — canal não registrado → `{ success: false }`, sem exceção.
3. Proteção — canal registrado mas sem capacidade `PRICE_UPDATE` → mesmo resultado protegido.
4. Proteção — `updatePrice()` do provider rejeita (erro de API externa) → o Dispatcher converte em `{ success: false }`, nunca propaga.

**Como rodar:**
```bash
cd apps/api
npm test -- price-update-dispatcher   # só este arquivo
npm test                               # suíte inteira
```

Documentado também em `docs/marketplace-intelligence-architecture.md`, seção 15 — inclui a orientação de que qualquer provider novo não precisa de teste próprio para o Dispatcher, só precisa continuar fazendo este passar sem alteração (ele testa o contrato, não uma API de canal específica).

**Próxima etapa (aguardando sua confirmação):** com o Dispatcher validado, o caminho natural é o módulo de Competition Intelligence, como você mencionou.

## Etapa 10 — Competition Intelligence (radar de concorrência): primeira fatia

Você pediu a arquitetura do módulo que monitora o mercado e gera os sinais que o Pricing Engine vai usar para decidir preço — seguindo 4 pilares: eventos, radar agnóstico à fonte, motor de oportunidade, e histórico sem afetar a leitura do Pricing Engine. Implementei os quatro:

- **Eventos de domínio** (`competition.price-changed`, `competition.buy-box-lost`, `competition.new-competitor-detected`) via `EventEmitter2` (mesmo mecanismo do Marketplace Intelligence desde a Etapa 4). A prova de que o Pricing Engine assina sem acoplamento está em código: `modules/pricing-intelligence/application/competitor-signal.listener.ts` — um listener registrado em `PricingIntelligenceModule`, que **não importa** `CompetitionIntelligenceModule`. `@nestjs/event-emitter` descobre o listener varrendo os providers da aplicação inteira; nenhum import de módulo é necessário para a assinatura funcionar.
- **`CompetitionRadar`** (`shared/contracts/competition-radar.contract.ts`): uma única interface, de propósito — ao contrário do `MarketplaceProvider` (capacidades segregadas, porque cada canal tem API bem diferente), aqui scraping/API de parceiro/planilha manual produzem o mesmo formato de dado, só a implementação muda. `ManualSheetRadar` é o radar de exemplo — estrutura, sem integração real (retorna `[]`), mesma honestidade da Etapa 7.
- **Motor de oportunidade** (`domain/opportunity-calculator.ts`): função pura, calcula gap de preço, ranking e status de Buy Box. Decisão de arquitetura registrada no doc: o CÁLCULO fica em Competition Intelligence (interpreta fato de mercado); a DECISÃO de reagir (reprecificar automaticamente ou só alertar) é do Pricing Engine, que consome o evento — Competition Intelligence não conhece margem, estratégia de preço nem o conceito de "reagir".
- **Histórico vs. read-model**: `CompetitorOfferSnapshot` (append-only, índice por `(tenantId, skuCode, collectedAt)` — é o que o Analytics vai consumir no futuro) fisicamente separado de `CompetitiveOpportunity` (upsert por `(tenantId, skuCode)`, sempre a última leitura — é a ÚNICA tabela que o Pricing Engine consulta, O(1) por SKU). Exportado como porta `COMPETITOR_SNAPSHOT_READER`, nome já previsto em `platform-architecture.md` desde antes deste módulo existir.

**Onde tudo mora:** novo `modules/competition-intelligence/` (domain/application/infrastructure/interface), novo schema Prisma `competition_intelligence`, reaproveitando `shared/sync-ops` para agenda/log/saúde do monitoramento (mesma infra genérica de Marketplace Intelligence e ERP Integration). Detalhes completos, incluindo os contratos por extenso e a receita para adicionar uma fonte de radar nova, em `docs/competition-intelligence-architecture.md`.

**Simplificações conscientes:**
- Nenhum radar real (scraping ou API paga tipo PriceAPI) foi implementado — é a próxima decisão de negócio (qual fonte contratar), não uma lacuna técnica.
- "Concorrente novo" usa um proxy simples (mudança de identidade do líder de preço) em vez de rastrear todo o conjunto de concorrentes já vistos por SKU.
- O listener no Pricing Intelligence só loga o sinal recebido — nenhuma regra de "quando reagir automaticamente" foi pedida ainda.

**Próxima etapa (aguardando sua confirmação):** contratar/implementar um radar real (scraping ou PriceAPI), ou definir a regra de reação automática do Pricing Engine aos sinais de concorrência — qual prefere seguir primeiro?

## Etapa 11 — PricingStrategist: o núcleo de decisão de preço

Você pediu o "coração" da precificação: um serviço que recebe a oportunidade competitiva e devolve uma decisão de preço, sempre respeitando a margem mínima. Implementado em `modules/pricing-intelligence/` (nome já em uso no código para o que o PRD chama de "Pricing Engine" — mantive, não criei um módulo paralelo):

- **`PricingStrategist`** (`domain/pricing-strategist.ts`): interface + `DefaultPricingStrategist`, 100% domínio puro (sem NestJS, sem porta, sem I/O) — recebe um `PricingContext` (custo, margens, preço atual, melhor preço de concorrente, status de Buy Box) já montado e devolve uma `PricingDecision`. Interface (não função solta, diferente das outras calculadoras do projeto) de propósito: é Strategy Pattern — estratégias alternativas (agressiva, conservadora, orientada por IA) entram depois, trocando só o binding de DI.
- **Regra de ouro, testada**: `calculateOptimalPrice` roda em duas fases — sugestão competitiva crua (igualar concorrente se perdendo Buy Box; manter preço se vencendo/sem dado) e depois um gate de segurança INCONDICIONAL contra `safetyFloorPrice = costPrice / (1 - minimumMarginPct/100)`. Se a sugestão furar a margem mínima — por qualquer motivo, inclusive o preço atual já estar errado antes de qualquer evento — o preço de segurança vence. `default-pricing-strategist.spec.ts` cobre os casos: concorrente acima do piso (iguala), concorrente abaixo do piso (nunca iguala, aplica o piso), e o caso defensivo (preço atual já abaixo do piso mesmo vencendo o Buy Box).
- **Desacoplamento do `MarketplaceProvider`**: `PricingStrategist` não tem portas, então é estruturalmente impossível ele conhecer um provider concreto. Quem monta o `PricingContext` (`PricingDecisionService`) só injeta `PRODUCT_CATALOG_READER` e `COMPETITOR_SNAPSHOT_READER` — nenhuma das duas portas expõe qual marketplace está por trás.
- **Pipeline ligado ao que já existia**: `CompetitorSignalListener` (Etapa 10, antes só logava o sinal) agora chama `PricingDecisionService.decide()` de verdade no evento `competition.buy-box-lost` e loga a `PricingDecision` calculada. Também há `GET /pricing-intelligence/decisions/:skuCode` para testar sob demanda, sem depender de um radar real.
- **Extensão de porta**: `ProductCatalogSummary` (Catalog → Pricing Intelligence) ganhou `desiredMarginPct`/`minimumMarginPct` — extensão aditiva, o simulador de margem da Nuvemshop que já consumia essa porta continua funcionando sem mudança.

Detalhes completos (diagrama do pipeline, o que falta para o motor de preço completo do PRD) em `docs/pricing-intelligence-architecture.md`.

**Simplificação consciente, deliberada:** a decisão é calculada e logada, **não aplicada**. O fio até `PRICE_UPDATE_DISPATCHER` (Etapa 8) está todo montado — falta uma chamada — mas aplicar preço real automaticamente é consequente demais para entrar sem sua confirmação explícita. Também só reage a `competition.buy-box-lost` por ora, não aos outros dois eventos.

**Próxima etapa (aguardando sua confirmação):** aplicar a decisão automaticamente (chamar o Dispatcher), reagir também aos outros eventos de concorrência, ou usar `desiredMarginPct` para sugerir um preço "ideal" ao lado do preço de segurança — qual prefere?

## Etapa 12 — Modo operação: automação de preço e botão "Aplicar Agora"

Você pediu os dois ajustes para tirar o `PricingStrategist` do modo "só sugere" para o modo "opera":

- **Flag `autoRepricingEnabled`** — em `Product` (`Prisma`, schema `catalog`), default `false`, opt-in por SKU (não é uma configuração global de tenant, mesma filosofia de `minimumMarginPct` já ser por produto). Editável via o endpoint de produtos normal (`POST`/`PATCH /products`) — não é campo travado por `sourceSystem`, porque é estratégia de precificação da Precifica, não um fato físico espelhado do ERP.
- **`PricingDecisionService` ganhou dois métodos novos**: `decideAndMaybeApply` (usado pelo `CompetitorSignalListener` no evento de Buy Box perdido — só aplica se a flag estiver ligada) e `applyDecision` (usado pelo endpoint manual — sempre aplica, ignora a flag, é o "clique no botão"). Os dois convergem num único método privado que resolve o canal, busca o `externalId` via `CHANNEL_LISTING_READER` e chama `PRICE_UPDATE_DISPATCHER.dispatch()` — mesma porta desacoplada da Etapa 8, o Strategist continua sem saber que Nuvemshop/Mercado Livre/Shopee existem.
- **`POST /pricing-intelligence/apply/:skuCode`** (ADMIN) — recalcula a decisão na hora (nunca aplica um preço com dado velho) e tenta aplicar de verdade. Devolve `{ decision, applied, reason, dispatchOutcome? }`, com motivo explícito sempre que não aplica (preço já é o mesmo, sem canal vinculado, sem anúncio encontrado, ou o dispatcher recusou) — nunca uma exceção não tratada.
- **Extensão de schema que isso exigiu**: `CompetitiveOpportunity` ganhou `channelCode` (o canal que gerou o `ourPrice` usado na comparação) — sem isso não haveria como saber ONDE aplicar o preço a partir só do SKU. `CompetitionMonitorOrchestrator` agora grava esse campo junto com cada leitura.

Detalhes completos (diagrama do pipeline com o novo branch de decisão, o passo a passo do `dispatchDecision`) na seção 7 de `docs/pricing-intelligence-architecture.md`.

**Simplificação consciente:** o botão em si ainda não existe na tela — o endpoint está pronto para quando você quiser a UI (não constrói front-end sem direção visual, como combinamos desde a Etapa 6). Também não há workflow de aprovação intermediário: hoje é binário, automação ligada ou desligada por SKU.

**Próxima etapa (aguardando sua confirmação):** construir a UI do botão "Aplicar Preço Agora" e o toggle de automação na tela de produto, ou seguir para Competition Intelligence/outro módulo — qual prefere?

## Etapa 13 — Governança financeira: piso por imposto + margem líquida mínima global

**Correção de premissa, para registro:** você pediu para buscar isso de uma tabela `TenantConfig` — ela não existe no projeto (nem existiu). A estrutura equivalente já usada para governança por tenant é `CatalogSettings` (Etapa 5, um registro por tenant) — estendi ela em vez de criar uma segunda tabela redundante. São conceitos e endpoints separados por serem coisas diferentes: `defaultMinimumMarginPct` é o piso **por SKU** (já existia); os campos novos, `taxRatePct`/`minProfitMarginPct`, são um piso **global do tenant**, sempre em vigor.

- **`FinancialPolicy`** (`shared/contracts/financial-policy-reader.port.ts`): `{ taxRate, minProfitMargin }`, como fração (0 a <1) — bate com a fórmula pedida. Implementada por `FinancialPolicyReaderService` (Catalog), consumida por `PricingDecisionService`.
- **Fórmula do piso financeiro**, exatamente como pedida: `FloorPrice = costPrice / (1 - (taxRate + minProfitMargin))` — `calculateFinancialFloorPrice`, ao lado do piso por produto já existente (`calculateSafetyFloorPrice`) em `domain/pricing-strategist.ts`.
- **Duas camadas de proteção, deliberadas:** (1) `DefaultPricingStrategist` agora calcula os dois pisos (produto e financeiro) e usa o maior — `action` vira `SAFETY_FLOOR_APPLIED` ou `FINANCIAL_FLOOR_APPLIED` conforme qual venceu; (2) `PricingDecisionService`, depois de receber a decisão, faz uma segunda checagem independente e sobrescreve se necessário, com a nota exata pedida: *"Preço ajustado para o piso financeiro por proteção de margem"*. Não é duplicação por acaso: o piso por produto é regra da estratégia (pode variar entre implementações); o piso financeiro é governança do tenant, que precisa valer não importa qual `PricingStrategist` esteja plugado.
- **Eficiência (sua pergunta):** em vez de introduzir Redis só para isso, `FinancialPolicyReaderService` usa um cache em memória por processo (TTL 5 min), invalidado imediatamente via evento (`EventEmitter2`, mesmo mecanismo do resto da plataforma) quando a política é atualizada — não fica esperando o TTL expirar para refletir uma mudança. Limitação honesta documentada: esse cache é local ao processo, só funciona porque a API roda como monólito de uma instância só.
- **Novos endpoints:** `GET/PUT /catalog/settings/financial-policy` (PUT só ADMIN).

Detalhes completos (diagrama de onde cada camada entra, todas as fórmulas) na seção 8 de `docs/pricing-intelligence-architecture.md`. Testes novos em `default-pricing-strategist.spec.ts` (qual piso vence quando) e `pricing-decision.service.spec.ts` (o gate da camada de aplicação).

**Próxima etapa (aguardando sua confirmação):** tela de front-end para configurar a política financeira (hoje só via API), ou seguir para outro módulo — qual prefere?

## Etapa 14 — Packaging Intel: custo e peso efetivos com embalagem vinculada

**Cadastro novo:** `Packaging` (`id, tenantId, name, weightG, heightCm, widthCm, lengthCm, costPrice, stockQuantity`), reutilizável entre produtos — CRUD próprio (`PackagingsService`/`PackagingController`, `/packagings`), mesmo padrão de `SuppliersService`. `Product.packagingId` é o vínculo opcional; sem vínculo, nada muda em relação a antes desta etapa.

- **Custo efetivo:** `PricingDecisionService` não muda uma linha de código. O `ProductCatalogReader.findBySku()` (Catalog) passou a somar `Product.costPrice + (Packaging.costPrice ?? 0)` e devolver isso como `costPrice` (mais um breakdown `productCostPrice`/`packagingCostPrice` para transparência) — como o Pricing Engine já lia esse campo através dessa porta desde a Etapa 11, ele herda o custo certo automaticamente.
- **Sua pergunta — como garantir que o estrategista saiba que o custo subiu se eu trocar a embalagem:** não há cache nenhum nesse caminho. `findBySku` busca `Product` + `Packaging` do banco em toda chamada, sem TTL, sem invalidação por evento — diferente de propósito do cache de 5 min do `FinancialPolicyReaderService` (Etapa 13): política fiscal pode atrasar alguns minutos sem problema; custo de aquisição não pode nunca estar desatualizado, porque é o dado que protege contra vender abaixo do custo. Trocar `packagingId` ou editar `Packaging.costPrice` vale a partir da próxima decisão, sempre.
- **Peso cubado:** nova função pura `resolveShippingDimensions` (Catalog domain) decide, antes de chamar `ShippingWeightCalculator` (Logistics Intelligence, que continua sem saber que Packaging existe), se as dimensões/peso de embalagem vêm da `Packaging` vinculada ou dos campos manuais do produto. Em `ProductsService.update()`, trocar só o `packagingId` (nenhum campo físico do produto) já dispara o recálculo — não fica peso cubado desatualizado silenciosamente.
- **Log de consumo (`PackagingUsageEvent`):** tabela append-only para o futuro DRE — `productId` como referência solta (não FK, mesmo padrão de `ChannelListing`/`CompetitiveOpportunity`), `packagingId` como FK real, `unitCostPrice` como cópia **congelada** no momento do evento (não uma referência viva). Honestidade técnica: não existe módulo de Vendas/Pedidos ainda para disparar isso sozinho — hoje é `PackagingUsageEventsService.record(...)` + `POST /packaging-usage-events`, manual, pronto para um futuro módulo de Vendas chamar no mesmo lugar em que confirma uma venda.

Detalhes completos na seção 9 de `docs/pricing-intelligence-architecture.md`. Testes novos: `shipping-dimensions-resolver.spec.ts` (função pura), `catalog-reader.service.spec.ts` (custo efetivo com/sem embalagem), `products.service.spec.ts` (troca de embalagem dispara recálculo de peso; embalagem inválida é rejeitada).

**Simplificação consciente:** `PackagingUsageEvent` existe como mecanismo (schema + porta + endpoint manual), não como pipeline automático — não há de onde disparar isso automaticamente ainda.

**Próxima etapa (aguardando sua confirmação):** tela de front-end para cadastro de embalagens e vínculo no formulário de produto, ou seguir para outro módulo — qual prefere?

## Etapa 15 — Financial Intelligence: DRE, Contas a Receber e reprecificação reativa

**Reaproveitamento, para registro:** o pedido de embalagens (`Packaging`, `Product.packagingId`, custo efetivo) já estava implementado desde a Etapa 14 — nada foi refeito. Esta etapa completou a peça que faltava (reprecificação reativa, ver abaixo) e construiu os dois módulos novos.

- **Novo bounded context `financial-intelligence`:** `FixedExpense` (despesa fixa recorrente — CONFIGURAÇÃO, uma linha por despesa cadastrada, não por ocorrência mensal) e `ReceivableRecord` (repasse esperado de marketplace — TRANSACIONAL, o "A Receber"). CRUD completo para os dois (`/financial-intelligence/fixed-expenses`, `/financial-intelligence/receivables`).
- **Reconciliação de repasses:** `SettlementReportParser` (porta agnóstica de formato, JSON/CSV) + `SettlementParserRegistry` (multi-provider, mesmo padrão de `MarketplaceProviderRegistry`) + `ReceivableReconciliationService` — casa cada linha do relatório importado contra `ReceivableRecord` por `(tenant, marketplaceSource, externalReference)` e marca `PAID`, idempotente. Endpoint manual `POST /financial-intelligence/settlements/import`. Parser registrado hoje é genérico (`GenericSettlementParser`) — nenhum formato real de marketplace foi confirmado ainda; trocar por um parser dedicado quando o formato real for conhecido não muda o resto do pipeline.
- **Sua pergunta — como o `PricingDecisionService` recalcula o Floor Price quando o custo muda:**
  - **Custo de embalagem:** o cálculo já estava sempre correto desde a Etapa 14 (leitura fresca, sem cache). O que faltava era proatividade — agora `PackagingsService.update()` emite `catalog.packaging-cost-changed` quando `costPrice` muda, e um novo listener (`PackagingCostChangeListener`, Pricing Intelligence) reage buscando os SKUs vinculados àquela embalagem (nova porta `PACKAGING_LINKED_PRODUCTS_READER`) e chama `decideAndMaybeApply` para cada um — reprecifica e já reaplica no marketplace na hora, sem esperar o próximo sinal de concorrência.
  - **Despesas fixas (DRE):** decisão consciente — **não entram na fórmula do Floor Price hoje**. Ratear despesa fixa em custo por unidade exige uma premissa de volume de vendas que o sistema não tem; inventar esse número seria uma decisão de negócio, não uma dedução da arquitetura. `FixedExpense` alimenta só relatório/DRE e a futura projeção de fluxo de caixa — duas extensões possíveis (rateio automático por volume projetado, ou markup manual configurável) documentadas mas não implementadas.
- **Fundação para Fluxo de Caixa Projetado:** `ReceivableRecord.status=PENDING` já é "entrada esperada numa data"; `FixedExpense.recurrenceType/dueDay` já contém a regra para "expandir" saídas futuras num calendário. Falta só o serviço de projeção/agregação — nenhuma mudança de schema esperada.

Detalhes completos (diagramas, honestidade técnica sobre o parser genérico, as duas extensões de rateio de DRE) em `docs/financial-intelligence-architecture.md`. Testes novos: `generic-settlement-parser.spec.ts`, `receivable-reconciliation.service.spec.ts` (match/sem match/idempotência), `packaging.service.spec.ts` (evento só quando `costPrice` muda de fato) e `packaging-cost-change.listener.spec.ts` (fan-out para SKUs vinculados).

**Próxima etapa (aguardando sua confirmação):** projeção de Fluxo de Caixa (o objetivo de longo prazo declarado neste pedido), tela de front-end para DRE/Contas a Receber, ou seguir para outro módulo — qual prefere?

## Nota — Arquitetura de Adaptadores Multicanal: já existe, sem código novo nesta nota

Pedido recebido em paralelo à Etapa 15: projetar uma estrutura de `Connectors`/`IMarketplaceConnector` para ler taxas de qualquer marketplace de forma padronizada, com isolamento de falha e armazenamento seguro de credenciais.

Essa estrutura já existe desde a Etapa 4 (`MarketplaceProvider` + interfaces de capacidade — `FeeRuleCapableProvider`, `ListingCapableProvider`, `PriceUpdateCapableProvider` — mais `MarketplaceProviderRegistry`), só com nomes diferentes dos usados no pedido. Isolamento de falha e criptografia de credenciais (`CredentialEncryptionService`, AES-256-GCM) também já existiam. Mapeamento completo pedido → implementação, mais o status real dos 6 canais citados (Nuvemshop funcional; Mercado Livre parcial; Shopee/TikTok Shop/Amazon/Magalu/SHEIN em backlog, sem stubs fabricados) na seção 16 de `docs/marketplace-intelligence-architecture.md`.

## Etapa 16 — Módulo de Pedidos: hub multicanal, worklist unificada e integração financeira

Novo bounded context `orders` (schema Prisma próprio) — o dado transacional que faltava para o restante da plataforma ter sentido: sem ele, Financial Intelligence não tinha receita real.

- **Contrato normalizado (`RawOrderCandidate`):** todo canal devolve pedidos já traduzidos para um formato único, com `status` já mapeado para os 6 estágios canônicos do worklist (`EM_ABERTO → PREPARANDO_ENVIO → FATURADO → ENVIADO → ENTREGUE`, mais `CANCELADO`). A tradução acontece exclusivamente dentro do adapter de cada canal (`NuvemshopOrderProvider.fetchOrders` + `mapNuvemshopStatus`, função pura testada sem mocks) — nunca no orquestrador genérico.
- **`OrderCapableProvider` + `OrderProviderRegistry`:** mesmo padrão plugin de `MarketplaceProviderRegistry`/`CompetitionRadarRegistry` — adicionar um canal novo é implementar a interface e registrar no `useFactory` do módulo, nunca alterar o registry ou o orquestrador.
- **`OrderSyncOrchestrator`:** pipeline por provider — fetch (paginação dentro do adapter) → resolução best-effort de SKU via `PRODUCT_CATALOG_READER` → upsert idempotente (`@@unique([tenantId, channelCode, externalOrderId])`) → detecção de transição de status (`determineOrderTransitionEvents`, função pura) → emissão de eventos. Reaproveita a mesma infra genérica de agenda/log/saúde (`shared/sync-ops`) do resto da plataforma.
- **Sincronização:** polling incremental via `OrdersSyncSchedulerJob` (a cada 10 min) é o mecanismo principal; um endpoint de webhook (`POST /orders/providers/:providerCode/webhook`) existe como "nudge" — dispara o mesmo pipeline incremental em vez de aplicar o payload do webhook diretamente (parsing/validação de assinatura por canal ainda não implementados — honestidade documentada em `docs/orders-architecture.md`, seção 6).
- **Integração financeira, sem duplicidade:** `ReceivableFromOrderListener` (Financial Intelligence) assina `ORDER_EVENTS.PAID`/`CANCELLED` importando só o arquivo de constantes/tipos de Orders (zero import de módulo, mesma regra do resto da plataforma) e usa a MESMA chave natural do pedido (`channelCode` + `externalOrderId`) para achar/criar/cancelar o `ReceivableRecord` correspondente, sem tabela de mapeamento própria. "Pago" é inferido pela saída de `EM_ABERTO`, não por um campo `paidAt` que pode faltar em alguns canais.
- **Endpoints:** `GET /orders` (filtros de canal/status/data + paginação real no banco), `GET /orders/status-counts` (contadores das 6 abas em uma query agregada), `GET /orders/:id`, `POST /orders/providers/:providerCode/sync` (trigger manual, ADMIN) e o webhook acima.
- **UI/UX (respondido em `docs/orders-architecture.md`, seção 7):** estrutura de colunas da worklist, badge de canal via mapa estático `channelCode → logo` no frontend (sem endpoint de metadados — over-engineering para 1-2 canais reais hoje) e paginação real (não scroll infinito/virtualização) como estratégia de performance para centenas de pedidos.
- **Ponto de extensão documentado, sem consumidor ainda:** `ORDER_EVENTS.READY_FOR_FULFILLMENT`, disparado ao entrar em `PREPARANDO_ENVIO` — reservado para um futuro módulo fiscal/logístico assinar (emissão de NF-e/etiqueta).

Detalhes completos (mapeamento de status por canal, diagramas de sequência, o que fica para a próxima fatia) em `docs/orders-architecture.md`. Testes novos: `order-transition-events.spec.ts`, `nuvemshop-order-status.mapper.spec.ts`, `order-sync-orchestrator.service.spec.ts` (sucesso, falha parcial, falha de provider, cada evento de transição) e `receivable-from-order.listener.spec.ts` (criação idempotente, cancelamento, proteção contra cancelar um repasse já `PAID`).

## Etapa 17 — Escalabilidade multicanal real: 7 marketplaces sem alteração estrutural

Pedido de arquitetura: detalhar como o hub de pedidos escala para Nuvemshop, Mercado Livre, Shopee, TikTok Shop, Amazon, Magalu e SHEIN sem que plugar um canal novo exija mudança no núcleo. Respostas completas em `docs/orders-architecture.md`, seções 11-12.

- **Extensibilidade do provider (Q1):** já resolvido desde a Etapa 4/5 via Interface Segregation — `OrderCapableProvider` é uma das quatro extensões de `MarketplaceProvider` (junto de `FeeRuleCapableProvider`/`ListingCapableProvider`/`PriceUpdateCapableProvider`). Adicionar SHEIN = implementar `fetchOrders()` (que resolve busca, mapeamento de status via uma função pura `mapSheinStatus()`, e cálculo de taxas via `feeAmount`/`netAmount`) + uma linha no array `ORDER_CAPABLE_PROVIDERS` do módulo. Zero mudança em `OrderSyncOrchestrator`/`OrderRepository`/`ReceivableFromOrderListener`.
- **Normalização financeira sem if/else (Q2):** `feeAmount`/`netAmount` viraram campos do próprio contrato `RawOrderCandidate`, calculados exclusivamente pelo adapter de cada canal (Nuvemshop: `feeAmount=0`, é loja própria do vendedor, sem comissão de marketplace). Fluem por todo o pipeline até `Order.netAmount` → `OrderPaidEvent.netAmount`, e `ReceivableFromOrderListener` agora lê `payload.netAmount` (não mais `totalAmount`) incondicionalmente — nenhum `if (channelCode === X)` no código financeiro.
- **Rate limiting por canal (Q3):** novo módulo `shared/rate-limiting/` — `RateLimiter` (token bucket genérico) + `marketplace-rate-limits.ts` (registro de cota por `channelCode`, com fail-safe conservador para canais sem entrada) + `withRetry`/`isRateLimitError` (retry com backoff em HTTP 429). Cada API client possui sua PRÓPRIA instância de `RateLimiter` (referência: `NuvemshopApiClient`) — o orquestrador nunca sabe que rate limiting existe, mesmo racional já usado para paginação. Ressalva documentada: o bucket do client é global à instância (todos os tenants do mesmo canal compartilham a cota) — seguro por construção, mas não isolamento de recurso por tenant.
- **Campos fiscais no contrato unificado (Q4):** `RawOrderCandidate` ganhou `fiscalResponsibility?` (`SELLER`/`MARKETPLACE` — quem emite a NF-e; alguns programas de venda da Amazon/Magalu faturam em nome do vendedor), `buyerTaxId?` (CPF/CNPJ, necessário para NF-e) e `invoiceNumber?`; `RawOrderItemCandidate.taxAmount?` (imposto discriminado por item, exigência fiscal brasileira). Todos opcionais/aditivos; Nuvemshop não os preenche hoje (default `SELLER` aplicado pelo repositório).
- **Sobre "isolamento perfeito":** confirmado com nuance. Isolamento de ERRO é real (try/catch por tenant e por pedido em `OrderSyncOrchestrator` — uma falha na Amazon não afeta outros canais/tenants). Consistência de dados via `netAmount` também é real. Mas isolamento de RECURSO entre tenants do mesmo canal não é total hoje (rate limiter global por client) — nomeado como trade-off consciente, não uma lacuna escondida.

Código novo: `shared/rate-limiting/{rate-limiter,marketplace-rate-limits,with-retry}.ts` + specs. Testes novos/atualizados: `rate-limiter.spec.ts`, `with-retry.spec.ts`, `order-sync-orchestrator.service.spec.ts` e `receivable-from-order.listener.spec.ts` (fixtures com `totalAmount` ≠ `netAmount` para provar que o listener usa o valor líquido).

## Etapa 18 — Frontend: Camada de Comando (Dashboard) e Tabela de Pedidos Unificada

Pedido de Frontend Expert/UI-UX: consolidar as duas telas que faltavam no `apps/web` para o hub multicanal ter uma interface, com identidade visual "cinza chumbo, fundo branco, detalhes azul neon (#00F0FF)".

- **Identidade visual:** o chumbo/fundo branco pedido já era a paleta `ink`/`canvas`/`surface` existente desde a Etapa 6 (não duplicada de propósito) — a única cor nova é `neon` (`#00F0FF`, `tailwind.config.js`), reservada para acento (KPI em destaque, ROI, insights de IA), nunca como cor de texto padrão. Motivo "circuitos/conexões" resolvido com `CircuitBackground` (SVG decorativo, opacidade 7%, atrás do header do Dashboard) em vez de uma textura pesada — sofisticação sem poluir.
- **`features/orders/api.ts`:** tipos espelhando `Order`/`OrderItem`/`OrderListPage`/`OrderStatusCounts` do backend (mesmo padrão de duplicação intencional de `features/catalog/api.ts`) + `fetchOrders`/`fetchOrderStatusCounts` via `apiClient`.
- **`OrderTable` (`components/orders/`):** worklist com abas de status (contadores agregados, uma query só) + filtro por canal (os 7 marketplaces do hub, com badge "em breve" nos 6 ainda sem adapter — ver Etapa 17) + paginação real no banco. Colunas: canal (`ChannelBadge`, cor 100% orientada a dado), pedido, data, **prazo de despacho** (destaque vermelho quando vencido e ainda não enviado/entregue), **valor total**, **valor líquido** com o % de margem ao lado (`netAmount`, não `totalAmount` — mesma disciplina financeira da Etapa 17), status unificado (`OrderStatusBadge`).
- **Sugestões de IA sem poluir a interface (pergunta 3):** `AIInsightBadge` — um ícone discreto por linha que só aparece quando HÁ sugestão para aquele pedido, com popover sob demanda (não uma coluna nova nem texto solto). No Dashboard, `AIInsightPanel` é um card dedicado no fim da grade. **Honestidade:** nenhum motor de sugestões existe no backend ainda — os dois componentes são o ponto de extensão (recebem `AIInsight[]` via prop), hoje alimentados com array vazio e um estado vazio claro, nunca um dado inventado.
- **Dashboard (Camada de Comando):** KPIs (receita bruta, receita líquida — destaque neon —, margem média, pedidos ativos) + `ChannelRoiList` (ROI por canal). **Honestidade:** não existe endpoint de analytics agregado no backend (Financial Intelligence hoje só tem CRUD de despesa/recebível) — os widgets são calculados no frontend a partir de uma amostra de até 200 pedidos recentes (`features/orders/dashboard-metrics.ts`), e "ROI por canal" é `netAmount/totalAmount` (o que sobra após a comissão do canal) — o proxy honesto disponível hoje, já que o custo de produto por pedido ainda não existe no contrato normalizado.
- **Nova rota `/pedidos`** (`OrdersPage` + `OrderTable`) e item novo na Sidebar.

Build verificado (`tsc --noEmit` limpo, `vite build` OK). Sem testes automatizados nesta fatia (frontend do projeto ainda não tem suíte de testes de componente configurada — mesmo estado das telas anteriores de `apps/web`).

## Etapa 19 — Orquestração de Custos: margem real por pedido

Pedido de Senior Backend Engineer: habilitar cálculo de margem real (lucro sobre custo de aquisição — diferente do `netAmount` da Etapa 17, que é receita após comissão do canal).

- **Correção de premissa:** `Product.costPrice` já existe desde a Etapa 2 (migração `20260711111209_pricing_decision`), `Decimal` **obrigatório**, já consumido pelo Pricing Engine via `ProductCatalogReader`. Nada para adicionar ali. O gap real era o Módulo de Pedidos nunca ter capturado custo no momento da venda.
- **`OrderItem.costPrice`** (nullable — snapshot do custo efetivo no momento do pedido, capturado pelo `OrderSyncOrchestrator` no mesmo lookup que já resolve `skuCode` via `ProductCatalogReader`, sem chamada extra). Deliberadamente **não** adicionado a `RawOrderItemCandidate`: custo é dado nosso, nenhum canal deveria fornecê-lo.
- **Migração escrita à mão** (`20260711130000_order_cost_and_fiscal_catchup`) — este sandbox não roda `npx prisma migrate dev` de verdade (sem Postgres/rede, mesma limitação pré-existente da Etapa 8). O SQL cobre, de propósito, tanto `OrderItem.costPrice` novo quanto o drift pendente da Etapa 17 (`Order.feeAmount/netAmount/fiscalResponsibility/buyerTaxId/invoiceNumber`, `OrderItem.taxAmount`) que nunca tinha ganhado uma migração. Todas as colunas são nullable ou com `DEFAULT` — nenhuma linha existente é perdida.
- **Fallback de margem (`domain/order-margin.ts`, puro):** `resolveItemCostPrice` — usa o snapshot do item (`ITEM_SNAPSHOT`) quando existe; senão usa o custo ATUAL do produto (`CURRENT_PRODUCT`); senão marca `UNKNOWN` e **exclui** o item dos totais agregados (nunca fabrica margem zero). `OrdersService.getMarginSummary` (novo, `GET /orders/:id/margin`) monta o fallback consultando o catálogo só para os SKUs que realmente precisam — uma vez por SKU, não por item.
- **Prioridade de integridade de dados, cumprida:** nenhuma venda existente muda de valor (`netAmount`/`totalAmount` intactos — margem por custo é dado aditivo, novo); nenhum número é inventado quando o custo é totalmente desconhecido.

Testes novos: `order-margin.spec.ts` (fallback puro — 10 casos), `orders.service.spec.ts` (novo arquivo — fallback com catálogo mockado, sem duplicar consulta por SKU repetido), `order-sync-orchestrator.service.spec.ts` (snapshot de custo capturado no sync). Docs em `docs/orders-architecture.md`, seção 13.

## Etapa 20 — Módulo interno de DRE: margem de contribuição em tempo real por canal

Pedido de Senior Financial Systems Architect: `DreReport` (`receitaBruta`/`deducoes`/`custosVariaveis`/`margemContribuicao`), `FinancialOrchestrator` lendo do `OrdersService` e agrupando por `channelId` entre os 7 marketplaces, pronto para o gráfico de barras comparativo do Dashboard, com a "Regra de Ouro": custo/taxa faltante sinaliza o pedido específico como Incompleto sem corromper o total do período.

- **Correção de premissa:** não existe `channelId` no schema — o identificador de canal em toda a plataforma é `channelCode` (string, ex. `NUVEMSHOP`), então `DreChannelBreakdown` usa `channelCode`, consistente com `Order`/`ChannelListing`.
- **"Ler do OrdersService" implementado como porta, não import direto:** nova porta `OrderFinancialsReader` (`shared/contracts/`, token `ORDER_FINANCIALS_READER`), implementada pelo próprio `OrdersService` (reaproveita `computeOrderMarginSummary` da Etapa 19, em lote) e exposta por `OrdersModule` via `useExisting` — `FinancialOrchestrator` injeta só a porta, nunca a classe concreta. Mesma disciplina de Ports & Adapters usada em todo módulo que consulta dado de outro (ex.: `PRODUCT_CATALOG_READER`).
- **Cálculo puro** (`domain/dre-report.ts`): `receitaBruta` (exclui `CANCELADO`) − `deducoes` (impostos + descontos) − `custosVariaveis` (CMV + fretes + comissão) = `margemContribuicao`, agrupado por `channelCode` e **pré-ordenado por margem decrescente** — consumível direto pelo gráfico de barras, sem lista fixa de "7 marketplaces" hardcoded (só aparecem canais com pedido real; juntar com o registro estático do frontend para sempre mostrar 7 barras é responsabilidade da UI).
- **Regra de Ouro:** item com custo desconhecido contribui 0 ao CMV (nunca bloqueia o pedido do total — aproximação conservadora-otimista, documentada); `feeAmount = 0` fora da Nuvemshop (único canal com comissão zero confirmada) é tratado como taxa suspeita. Cada pedido problemático aparece em `incompleteOrders[]` (`orderId`, `externalOrderId`, `channelCode`, motivos) — localiza o pedido exato para correção. `dataQuality: 'COMPLETE' | 'INCOMPLETE'` no relatório inteiro e por canal.
- **Endpoint:** `GET /financial-intelligence/dre?dateFrom=&dateTo=`, sem cache — recalcula do banco a cada chamada (mesma filosofia de "nunca cachear custo" do `ProductCatalogReader`).

Testes novos: `dre-report.spec.ts` (cálculo, agrupamento/ordenação multi-canal, exclusão de CANCELADO, os 4 cenários da Regra de Ouro, período vazio), `financial-orchestrator.service.spec.ts` (delegação à porta, com/sem período, multi-canal), extensão de `orders.service.spec.ts` (`listForPeriod`, dedupe de catálogo por SKU no período). Docs em `docs/financial-intelligence-architecture.md`, seção 7.

## Sprint 21 — Conexão de Canais Core: adaptadores de pedidos (Nuvemshop + Mercado Livre)

Pedido de Senior Integration Engineer: `src/adapters/` com um `Client` por canal (Nuvemshop, Mercado Livre), `OrderSyncOrchestrator` normalizando a resposta bruta para `RawOrderCandidate`, endpoint `POST /webhooks/:channel`, log de auditoria por tentativa de sync, e interfaces prontas para plugar Shopee/TikTok no futuro sem acoplar o orquestrador a lógica de API de terceiros.

- **Três correções de premissa, todas favoráveis ao pedido:** (1) não existe `src/adapters/` — cada canal já mora dentro do módulo dono da integração (`erp-integration/infrastructure/nuvemshop/`, `marketplace-intelligence/infrastructure/providers/mercado-livre/`), mesma disciplina de bounded context da Etapa 3; criar uma pasta técnica cross-module duplicaria essa organização. (2) a normalização `raw -> RawOrderCandidate` já é (e continua sendo) responsabilidade exclusiva de cada adapter, nunca do `OrderSyncOrchestrator` — que já existe desde a Etapa 16 e já é 100% agnóstico de canal, exatamente a "interface" pedida no item 1 (`OrderCapableProvider`, documentada desde a Etapa 17 como a receita de plug-and-play). (3) Mercado Livre exige OAuth2 completo por vendedor para listar pedidos — infraestrutura que não existe ainda (sem `MercadoLivreConnection`); implementar de fachada seria pior que não implementar, então a estrutura foi construída por completo (client, normalizador, mapper de status, provider registrado) mas o gate de credencial lança de forma honesta em vez de fingir uma chamada que nunca funcionaria.
- **Novo:** `MercadoLivreOrderProvider` (`implements OrderCapableProvider`) + `mercado-livre-order-normalizer.ts` + `mercado-livre-order-status.mapper.ts`, registrados em `MarketplaceIntelligenceModule` e consumidos por `OrdersModule` — segunda entrada em `ORDER_CAPABLE_PROVIDERS`, zero mudança em `OrderSyncOrchestrator`/`OrderProviderRegistry`/`OrderRepository`, prova prática de que o modelo já era plug-and-play.
- **Webhook por canal:** `POST /webhooks/:channel` (novo `WebhooksController`), fachada sobre o webhook por `providerCode` já existente desde a Etapa 16 — resolve o(s) provider(s) do canal via `OrderProviderRegistry.findByMarketplaceCode()` (novo método) e dispara o mesmo pipeline de nudge incremental, sem duplicar lógica de sync.
- **Log de auditoria (item 4):** já resolvido desde a Etapa 16 — `ProviderSyncLogRepository.start/finish` grava toda tentativa de sync com `status`/`errorDetails`, conectando diretamente com a Regra de Ouro da Etapa 20 (falha de conexão vira dado rastreável, nunca um silêncio). Nenhum código novo de logging foi necessário; a prova é que a falha honesta do Mercado Livre (OAuth2 não implementado) já aparece nesse mesmo log assim que o provider for exercitado pelo scheduler.

Testes novos: `mercado-livre-order-status.mapper.spec.ts`, `mercado-livre-order-normalizer.spec.ts`, `mercado-livre-order.provider.spec.ts`, `order-provider-registry.service.spec.ts` (novo), `webhooks.controller.spec.ts`. Docs em `docs/orders-architecture.md`, seção 14.

**Nota (Sprint 22):** o gap de OAuth2 do Mercado Livre descrito acima foi fechado — ver entrada abaixo.

## Sprint 22 — Autenticação Real do Mercado Livre (OAuth2 completo)

Pedido de Senior Integration Engineer: `MercadoLivreConnection` gerenciando o fluxo OAuth2 (receber `code`, trocar por `access_token`/`refresh_token`, armazenar com segurança), schema por `sellerId`, renovação automática antes de cada chamada, `MercadoLivreOrderProvider` consumindo a conexão real em vez de lançar erro, e `docs/auth-security.md` documentando a proteção das chaves.

- **Schema:** `MercadoLivreConnection` (schema `marketplace_intelligence` — mesmo módulo que já possui `MercadoLivreApiClient`/`MercadoLivreOrderProvider`, ownership consistente), com `sellerId`, `accessTokenEnc`/`refreshTokenEnc` (sempre criptografados), `expiresAt`, `scope`, `isActive`. Migração escrita à mão (mesma limitação de rede/Postgres já documentada desde a Etapa 8).
- **`MercadoLivreConnectionService` implementa `AuthStrategy`** (`shared/contracts/auth-strategy.contract.ts`, definida desde a Etapa 4 e nunca implementada até agora) — `buildAuthorizationUrl` (state criptografado com `tenantId` embutido, nunca em texto puro na URL), `handleCallback` (troca `code` por tokens), `getValidAccessToken` (renova automaticamente 5 minutos antes de expirar — o coração do pedido: nenhum chamador decide isso sozinho), `disconnect`, `getStatus`.
- **`MercadoLivreApiClient`** ganhou `exchangeCodeForToken`/`refreshAccessToken` (POST `/oauth/token`, RFC 6749) — `fetchOrders` (Sprint 21, já implementado) agora é alcançável de verdade.
- **`MercadoLivreOrderProvider`** não lança mais `NotImplementedException`: `listTenantIdsToSync` lê as conexões ativas, `fetchOrders` busca token válido (renovado se necessário) + `sellerId` e chama a API real. Zero mudança em `OrderSyncOrchestrator`/`OrderProviderRegistry` — mesma prova de plug-and-play da Sprint 21.
- **Endpoints:** `GET .../authorize` [ADMIN] devolve a URL de autorização; `GET .../callback` é **público de propósito** (o Mercado Livre redireciona o navegador do vendedor, sem JWT nosso) — a proteção é o `state` criptografado, não um guard; `GET .../status` e `DELETE .../connect` seguem o mesmo padrão de `NuvemshopConnectionController`.
- **Segurança (item 4 do pedido):** documentada em `docs/auth-security.md` — criptografia AES-256-GCM em repouso (mesmo `CredentialEncryptionService` desde a Etapa 5), por que o `state` é criptografado (não só assinado) para também esconder o `tenantId`, janela de validade do state (10 min), margem de segurança do refresh (5 min), rotação de refresh_token, e os gaps honestos (chave única sem KMS/rotação, sem lock contra refresh concorrente, sem revogação ativa no Mercado Livre ao desconectar).

Testes novos: `mercado-livre-connection.service.spec.ts` (autorização não vaza tenantId, state adulterado/expirado rejeitado, renovação automática quando vencido ou perto de vencer vs. token ainda válido nunca renova, disconnect/status/listActiveTenantIds), `mercado-livre-order.provider.spec.ts` (reescrito para o comportamento real com OAuth2). Docs em `docs/auth-security.md` e `docs/orders-architecture.md` (seção 14, atualizada).

## Modo de Demonstração (Audit Mode) — auditoria técnica da Shopee + apresentações profissionais

Pedido de Senior Systems Architect: `AuditSeederService` injetando 10 pedidos fictícios (margem positiva/negativa, frete alto, taxas variadas), flag `isDemo` segregando esses pedidos de todo relatório financeiro real, flag de estado `appMode` (Real/Demo) no frontend com um botão discreto Admin-only no Dashboard, e `docs/audit-mode.md` para anexar à solicitação de auditoria.

- **`Order.isDemo: Boolean @default(false)`** (migração `20260711190000_order_audit_mode`) — o único sinal de pedido fictício. O tipo `AppDataMode` (`'REAL' | 'DEMO'`) é definido em `orders/domain/order.entity.ts` e duplicado em `shared/contracts/order-financials-reader.port.ts`, mesma disciplina de DTO autocontido do resto da plataforma.
- **Segregação estrutural, não convencional:** o filtro `WHERE isDemo = ...` vive dentro de `PrismaOrderRepository` (a camada mais baixa possível) — todo método do `OrderRepository` ganhou um `dataMode?: AppDataMode` opcional, com **ausente sempre significando `REAL`**. Isso atravessa `OrdersService` → porta `OrderFinancialsReader` → `FinancialOrchestrator.generateDreReport`: o DRE da Etapa 20 nunca mistura pedido de demonstração com dado real da Rita Mazzei Beauty, mesmo que um código futuro esqueça de pensar nisso.
- **`AuditSeederService`** (novo, `orders/application/`) — upsert direto no `ORDER_REPOSITORY` (sem passar pelo `OrderSyncOrchestrator`, já que não existe canal externo nenhum por trás), com `externalOrderId` fixo (`DEMO-AUDIT-001..010`, idempotente pela mesma chave de negócio de todo sync real) e `costPrice` fixo por item (nunca resolvido contra o catálogo real, para margem determinística). Os 10 cenários cobrem os 4 pedidos originais (margem positiva/negativa, frete alto, taxa alta) mais 3 bônus que exercitam a Regra de Ouro da Etapa 20 (pedido cancelado, custo desconhecido, taxa zero suspeita fora da Nuvemshop).
- **Endpoints `/audit-mode`** (novo `AuditModeController`, ADMIN-only): `GET status`, `POST seed` (idempotente), `POST clear` (`deleteDemoOrders`, `WHERE isDemo = true` explícito — nunca "todos menos os reais"). `GET /orders`, `GET /orders/status-counts` e `GET /financial-intelligence/dre` ganharam o parâmetro de query opcional `mode`.
- **Frontend:** `AppModeProvider`/`useAppMode()` (mesmo padrão de Context de `AuthProvider`), persistido em `localStorage`, com `canToggle` travado a `user.role === 'ADMIN'`. `AppModeToggle` — botão discreto no canto do hero do Dashboard, que **não renderiza nada** para quem não é Admin (nem desabilitado). `mode` entra na `queryKey` do react-query em `OrderTable`/`DashboardPage` — trocar de modo força um refetch limpo, nunca reaproveita cache do modo anterior.

Testes novos: `audit-seeder.service.spec.ts` (10 pedidos exatos, todos `isDemo`, os 4 cenários pedidos + os 3 bônus da Regra de Ouro, idempotência, `clear`/`getStatus`); atualizados: `orders.service.spec.ts`, `order-sync-orchestrator.service.spec.ts`, `order-margin.spec.ts` (fixtures com `isDemo`), `financial-orchestrator.service.spec.ts` (repasse de `dataMode`). Docs em `docs/audit-mode.md`.

## Sprint 24 — Gestão Logística e Auditoria: Hub de Provas + modelo de depósitos (Full Fulfillment)

Pedido de Arquiteto de Sistemas de E-commerce: um módulo unificado de logística/auditoria que sirva tanto o "Full Fulfillment" (despacho para CD de marketplace) quanto a "Auditoria de Vendas" (envio de varejo), com (1) um "Hub de Provas" ligando pedido/envio, mídia de conferência, status (Pendente/Aprovado/Divergente) e NF; (2) depósitos virtuais por canal do Full vs. estoque físico, fluxo de transferência físico→virtual, e inteligência de abastecimento por ABC/giro; (3) integração financeira para que o custo do Full chegue ao DRE. Tarefa inicial (confirmada com "sim" após apresentação do desenho): implementar o Hub de Provas + o modelo de depósitos, deixando abastecimento e `custoFull` no DRE como próxima fatia.

- **Novo módulo `logistics-fulfillment`** — schema `Warehouse` (físico + `CD_FULL_<canal>`, mesma entidade distinguida por `type`), `StockMovementAuditEvent` (o Hub de Provas: 1 registro por evento de saída de estoque, `eventType: FULL_DISPATCH | RETAIL_SHIPMENT`), `StockMovementAuditEventOrder` (join N:N com `Order`) e `StockLedgerEntry` (ledger append-only, `auditEventId` `NOT NULL`).
- **Regra de ouro estrutural:** o único método de toda a aplicação capaz de gravar uma `StockLedgerEntry` é `StockMovementAuditEventService.approve()`, bloqueado por `canApprove()` (função pura) — só passa se o evento estiver `PENDENTE` **e** tiver `mediaUrl` anexado. `markDivergent()` nunca grava ledger e sempre emite alerta técnico `ERROR` (mesma porta `AlertService` da Sprint 23).
- **Primeiro consumidor real de `ORDER_EVENTS.READY_FOR_FULFILLMENT`** — evento que existia desde a Etapa 16/17 documentado como "ponto de extensão, nenhum consumidor ainda". `OrderReadyForFulfillmentListener` cria o evento `RETAIL_SHIPMENT` `PENDENTE` automaticamente ao pedido entrar em `PREPARANDO_ENVIO`, idempotente por pedido, nunca lança (sempre alerta em falha) — mesmo padrão de import de `ReceivableFromOrderListener` (só o arquivo de eventos do módulo Orders, zero acoplamento circular).
- **Interface HTTP:** `POST /logistics-fulfillment/audit-events` (monta lote `FULL_DISPATCH` manual), `GET .../:id`, `POST .../:id/media` (base64+contentType, mesma simplificação de `ImportSettlementDto`, persistido via `FILE_STORAGE` — agora reexportado por `ErpIntegrationModule`), `POST .../:id/approve`, `POST .../:id/divergent`, `GET /logistics-fulfillment/warehouses` e `.../:id/balances`.
- **Gap honesto:** abastecimento ABC/giro e `custoFull` no DRE ficaram só no desenho (pseudo-código/próxima extensão aditiva), não implementados nesta sprint. Sem trigger de banco — a regra de ouro é só de aplicação, mesmo racional do piso redundante do `PricingDecisionService`. Os três repositórios Prisma novos não passam em `tsc --noEmit` neste sandbox pelo mesmo bloqueio de rede (Prisma Client não regenerável aqui) que já afeta todo repositório Prisma existente — resolve-se ao rodar `npx prisma migrate dev` no ambiente real.

Testes novos: `stock-movement-audit-event.spec.ts` (10, domínio puro), `warehouse.service.spec.ts` (3), `stock-movement-audit-event.service.spec.ts` (9), `order-ready-for-fulfillment.listener.spec.ts` (3) — 25 no total, todos passando. Docs em `docs/logistics-fulfillment-architecture.md`.

## Sprint 25 — Inteligência de Abastecimento (painel de reposição) + lead time configurável

Pedido de continuação (após a Sprint 24): uma tabela-resumo de decisão rápida — `SKU | Giro na Plataforma X | Saldo Atual no Full | Sugestão de Envio do Físico | Status de Abastecimento` — fechando a "inteligência de abastecimento" deixada como gap honesto no fim da Sprint 24. No meio da implementação, novo pedido explícito do usuário: o lead time de reposição deixar de ser constante no código e virar configurável por depósito (padrão 15 dias).

- **`domain/replenishment-advisor.entity.ts`** — `classifyAbc` (curva ABC por Pareto, 80/95%) + `computeReplenishmentSuggestion` (cobertura atual vs. alvo = lead time + segurança da classe; sugestão nunca excede o saldo físico disponível; status `CRITICO`/`ATENCAO`/`OK`/`SEM_GIRO`).
- **`ReplenishmentAdvisorService`** — reaproveita `ORDER_FINANCIALS_READER` (a MESMA porta que já alimenta o DRE desde a Etapa 20) para o giro por SKU/canal em uma janela de 30 dias, cruzado com os saldos do ledger (`StockLedgerRepository`, Sprint 24). Tabela ordenada por urgência — o mais crítico sempre no topo.
- **Lead time configurável:** `Warehouse.leadTimeDays` (schema estendido, não uma tabela nova — mesmo racional econômico de `CatalogSettings`), editável via `PATCH /logistics-fulfillment/warehouses/:id/lead-time` (ADMIN/PRICING_EDITOR), validado (inteiro positivo, teto 90 dias, sem lista fechada de opções) e sempre lido do banco pelo `ReplenishmentAdvisorService` — nunca uma constante.
- **Endpoint:** `GET /logistics-fulfillment/replenishment?channelCode=X`.
- **Frontend:** nova página `/abastecimento` — seletor de canal, painel de configuração do lead time (atalhos 3/7/15 dias + valor customizado) e a tabela pedida literalmente, com badges de status e aviso quando o físico não cobre a sugestão ideal.
- **Gap honesto:** `custoFull` no DRE continua em aberto (fora do escopo desta sprint); classificação ABC recalculada em memória a cada chamada, sem histórico persistido.

Testes novos: `replenishment-advisor.spec.ts` (10, domínio puro), `replenishment-advisor.service.spec.ts` (7), extensão de `warehouse.service.spec.ts` (+4) — módulo `logistics-fulfillment` completo com 45 testes/6 suítes, todos passando. Build do frontend (`tsc -b && vite build`) verificado sem erros. Docs em `docs/logistics-fulfillment-architecture.md`, seção 7.

## Sprint 26 — Módulo Central de Promoções: Motor de Cálculo de Margem

Pedido de Arquiteto de Sistemas de E-commerce: validar a viabilidade de uma promoção **antes** de ativá-la — um "Semáforo de Margem" (VERDE/VERMELHO, `M.C. Líquida = Preço − Taxas − Custos − Logística`) que bloqueia proativamente a adesão de um SKU quando a margem líquida resultante seria negativa. Refinamento pedido no meio do desenho, antes de qualquer código: o custo logístico não pode ser um valor fixo por depósito — precisa vir do módulo de embalagens já existente, com uma hierarquia de resolução (kit/combo → agrupamento dinâmico → default de segurança). Confirmado com "sim" após apresentação do desenho revisado.

- **Novo módulo `promotion-intelligence`** — schema `PromotionCampaign` (janela, canal, status) e `PromotionEnrollment` (adesão de um SKU, com **snapshot completo** do cálculo no momento da decisão — mesmo racional de `OrderItem.costPriceUsed`, Etapa 19 — nunca recalculado silenciosamente depois).
- **`domain/margin-calculator.ts`** — `calculateNetMargin` (pura) + `canEnrollInPromotion` (gate puro, mesmo padrão de `canApprove`/`canMarkDivergent` do Hub de Provas). Zero é tratado como VERMELHO, nunca um terceiro estado neutro.
- **Hierarquia de custo de embalagem** (`LogisticsCostReaderService`, em `logistics-fulfillment`, nova porta `LOGISTICS_COST_READER`): Prioridade 1 (kit — `Product.isKit` reaproveita `packagingId` para a "Embalagem de Agrupamento", `Packaging.purpose === 'GROUPING'`), Prioridade 3 (default de segurança, `purpose === 'SAFETY_DEFAULT'`). Prioridade 2 (agrupamento dinâmico multi-SKU por cubagem, `purpose === 'MASTER'`) foi construída como método reservado (`getPackagingCostForOrder`) mas **não consumida ainda** — é um conceito de pedido real, incompatível com a avaliação pré-venda de um SKU isolado; fica para uma futura integração com o DRE.
- **`PromotionIntelligenceService`** — `computeMargin` (pré-visualização pura) e `validateEnrollment` (aplica o gate e persiste via upsert). Reaproveita `FEE_RULE_RESOLVER` e `FINANCIAL_POLICY_READER` já existentes — deliberadamente **sem** criar uma `ConfiguracaoCanal` nova, para não duplicar fonte de verdade.
- **Interface HTTP:** `POST/GET /promotion-intelligence/campaigns`, `GET .../:id/margin-preview`, `POST .../:id/enrollments` (sempre 201, mesmo bloqueado — o bloqueio é dado de negócio, não erro HTTP), `GET .../:id/enrollments`.
- **Gap honesto:** Prioridade 2 do `LogisticsCostReader` sem consumidor ainda (ver acima); `custoFull` no DRE continua em aberto (`docs/logistics-fulfillment-architecture.md`, seção 6, atualizada nesta sprint). Prisma Client local neste sandbox segue parado desde as primeiras etapas (só `User`/`Product`) — `tsc --noEmit` do repositório inteiro falha por esse motivo pré-existente para todo repositório Prisma, não por erro desta sprint; verificação feita via `npx jest <módulo>`.

Testes novos: `margin-calculator.spec.ts` (7, domínio puro), `promotion-campaign.service.spec.ts`, `promotion-intelligence.service.spec.ts` (13 juntos) — 20 no total, todos passando. Catalog (13), logistics-fulfillment (58) e orders+financial-intelligence (89) reverificados sem regressão. Docs em `docs/promotion-intelligence-architecture.md`.

## Sprint 27 — Módulo de Separação e Expedição (Pick & Pack)

Pedido de Arquiteto de Sistemas de E-commerce, com liberdade técnica total sobre integração de hardware (câmeras) e software, sujeita a 4 premissas de negócio: (1) sistema "juiz" — checklist com fotos, "Finalizar Embalagem" bloqueado até 100% bipado; (2) auditoria visual em vídeo vinculada automaticamente ao pedido, estratégia de captura livre; (3) retenção de arquivos de 30 dias sem impactar performance do servidor; (4) resiliência a falha de rede/travamento no meio da gravação. Estende o Hub de Provas (Sprint 24) em vez de criar um módulo novo.

- **Checklist de bipagem** (`StockMovementAuditEventItem`, 1:N com `StockMovementAuditEvent`) — montado uma vez na criação do evento, agregado por SKU a partir dos itens dos pedidos vinculados (`buildChecklistFromOrderItems`); item sem SKU resolvido fica fora do checklist, reportado via `logger.warn`, nunca descartado em silêncio. `canApprove` ganhou um segundo parâmetro (`items`) — checklist vazio permanece vacuamente aprovado, preservando o comportamento legado de `FULL_DISPATCH` de reabastecimento preventivo.
- **Captura de vídeo em chunks** (`VideoCaptureSession`, 1:1) — estratégia escolhida: **MediaDevices API (`getUserMedia`) + `MediaRecorder` no navegador**, upload incremental via `timeslice`, explicitamente rejeitando RTSP/servidor de mídia dedicado (justificativa completa em `docs/pick-pack-architecture.md`, seção 2: é gravação por sessão de conferência, não vigilância contínua). Protocolo de idempotência por número de sequência (`canAcceptChunk`) trata retransmissão e lacuna de rede sem estado do lado do cliente. `finalize()` reaproveita o MESMO `attachMedia()` do Hub de Provas — `canApprove` não precisou de lógica nova para "tem mídia".
- **Nova porta `VideoChunkStorage`** (deliberadamente separada de `FileStorage`, que assume Buffer inteiro em memória) — `LocalVideoChunkStorageService` grava em disco via `fs.appendFile` (nunca reescreve), reaproveitando a mesma raiz/`ServeStaticModule` já registrado para fotos.
- **Retenção de 30 dias** — `VideoRetentionCleanupJob` (`@Cron` diário, mesmo padrão de `OrdersSyncSchedulerJob`) apaga só o arquivo físico, nunca a linha de `VideoCaptureSession` (registro permanente da conferência); defesa em profundidade (reconfere `isExpiredForRetention` mesmo após o filtro da query); falha em um arquivo não impede os demais.
- **Interface HTTP:** `GET /logistics-fulfillment/audit-events/pending` (fila FIFO), `.../:id/checklist`, `POST .../:id/scan`, `POST .../:id/video-sessions`, `GET .../:id/video-sessions`, `POST .../:id/video-sessions/:sessionId/chunks`, `POST .../:id/video-sessions/:sessionId/finalize`. Limite do body-parser JSON elevado para 15mb (chunks de vídeo em base64).
- **Frontend:** nova página `/conferencia` (fila de pendentes) e `/conferencia/:eventId` (tela de conferência — checklist com fotos do catálogo, input de bipagem por código de barras/manual, preview de câmera ao vivo, gravação com upload incremental de chunks, botão "Finalizar Embalagem" bloqueado no cliente até checklist 100% + vídeo finalizado — o gate real continua sendo o backend).
- **Gap honesto:** checklist vazio por TODOS os itens sem SKU resolvido seria vacuamente aprovado (mitigado só por log, sem guard mais rígido); fluxo de `FULL_DISPATCH` manual sem UI dedicada; fila de pendentes sem paginação (aceitável no volume esperado); retenção via `@Cron` local, não Lifecycle Policy de nuvem (documentado como caminho de migração para quando o storage for S3/R2).

Testes novos: extensões de `stock-movement-audit-event.spec.ts` (checklist) e novo `video-capture.spec.ts` no domínio; extensões de `stock-movement-audit-event.service.spec.ts` (checklist/scan/fila) e novo `video-capture.service.spec.ts` na aplicação. Módulo `logistics-fulfillment` + `financial-intelligence` + `orders` + `promotion-intelligence` + `catalog` reverificados em conjunto — 28 suítes / 227 testes, todos passando, sem regressão. Frontend (`npx tsc --noEmit`) limpo. Docs em `docs/pick-pack-architecture.md` (design técnico completo) e `docs/logistics-fulfillment-architecture.md`, seção 9.

## Deploy em produção — Render + Supabase + R2

Backend real em produção em `https://api.kyneti.com.br` (`/api/health` respondendo ok). Build no Render precisou de `--include=dev` (as devDependencies do NestJS/TypeScript são necessárias no passo de build); migração aplicada automaticamente via `prisma migrate deploy` no início do boot; credencial do Supabase com senha URL-encoded na connection string. Checklist completo e detalhes em `docs/deploy-render-supabase-r2.md`, seção 4.5.

## Módulo de Ads Multicanal — Fase 0 (acesso às APIs) — **EM STANDBY**

**Status: pausada por decisão de negócio (16/07/2026), não por bloqueio técnico.** O levantamento em `docs/marketplace-ads-api-access-plan.md` confirma o motivo estratégico: pelo menos Shopee exige explicitamente "produto vivo publicamente acessível" e "uma conta de teste/trial que a plataforma possa usar para validar o produto funcionando de verdade" como pré-requisito de homologação — Amazon exige uma auditoria de segurança formal (Security Onboarding Review) igualmente dependente de um produto demonstrável. Pedir acesso agora, com o backend maduro mas sem um layout/UI representável numa demonstração, arrisca reprovação ou atraso na revisão dessas plataformas.

**Retomar quando:** o layout/UI do sistema estiver maduro o suficiente para uma demonstração visual completa dos fluxos principais (não precisa ser 100% do produto — precisa cobrir os fluxos que cada marketplace pede para ver "funcionando de verdade"). Mercado Livre é a exceção — já resolvido desde o Sprint 22 (app OAuth2 já registrado, só falta pedir o escopo `advertising/product_ads` a mais), não depende desta pausa.

**Lembrete de governança (para a Claude, nas próximas sessões):** assim que o sprint de layout/UI avançar a ponto de cobrir os fluxos-chave para demonstração, cobrar do usuário a retomada da Fase 0 — formalizar as solicitações de acesso junto a Shopee/TikTok/Amazon/Magalu antes que o atraso se torne um gargalo de lançamento.

## Módulo de Ads Multicanal — Fase 1 (dashboard de leitura, Mercado Livre)

Autorizado pelo usuário com escopo explícito: implementação real cobre só Mercado Livre nesta fase, mas toda a arquitetura (registro de providers, orquestrador de sync, serviço de insights) é multicanal desde o início — adicionar Shopee/TikTok/Amazon/Magalu depois é só registrar mais um `AdsCapableProvider`, sem alterar orquestrador/serviço.

- **Contrato normalizado** (`RawAdsCampaignCandidate`/`RawAdsMetricCandidate`, `AdsCapableProvider`) em `shared/contracts/marketplace-provider.contract.ts`, mesma disciplina de `RawOrderCandidate`: o adapter é o único lugar que conhece o formato bruto do canal.
- **Domínio puro** (`domain/ads-metrics.ts`): ROAS, TACOS e classificação de saúde de campanha em 4 tiers (`ESTRELA`/`PONTO_DE_ATENCAO`/`CUSTO_PERDIDO`/`SEM_DADOS`) — limiares parametrizáveis, nunca hardcoded.
- **TACOS reaproveita `ORDER_FINANCIALS_READER`** — a MESMA porta que já alimenta o DRE — em vez de inventar uma segunda fonte de "receita orgânica" (nenhuma API de Ads reporta isso de verdade).
- **`MercadoLivreAdsProvider`** mora dentro de `marketplace-intelligence` (mesmo módulo de `MercadoLivreOrderProvider`), reaproveitando a MESMA conexão OAuth2 já existente — nenhuma reautorização do vendedor, só o escopo `advertising/product_ads` habilitado no painel do Mercado Livre.
- **`AdsSyncOrchestrator`** espelha `OrderSyncOrchestrator` (upsert por item com try/catch, alerta em falha de batch), agendado a cada 2h via `AdsSyncSchedulerJob`.
- **Endpoints:** `GET /marketplace-ads/dashboard`, `POST /marketplace-ads/providers/:providerCode/sync`.
- **Schema Prisma novo:** `marketplace_ads` (`AdsCampaign`, `AdsMetricSnapshot`), migração hand-written em `prisma/migrations/20260713150000_marketplace_ads/`.
- **Plano de acesso às APIs** dos demais marketplaces (Shopee, TikTok, Amazon, Magalu) documentado em `docs/marketplace-ads-api-access-plan.md` — os 4 caminhos NÃO são iguais (Shopee/TikTok são autoatendimento; Amazon exige revisão de segurança em múltiplos estágios; Magalu exige onboarding via "Acelera com Magalu").
- **Gap honesto:** endpoints de Ads do Mercado Livre montados a partir de fontes secundárias (documentação oficial não pôde ser lida por completo neste ambiente) — paths/shape ainda não validados contra chamada real, só serão confirmados quando o acesso de API for concedido.

Testes: `ads-metrics.spec.ts` (12, incluindo a máquina de estado de alerta), `mercado-livre-ads.provider.spec.ts` (~10), `ads-sync-orchestrator.service.spec.ts` (9), `ads-insights.service.spec.ts` (3), `ads-alerting.service.spec.ts` (7) — 42 testes, todos passando. `tsc --noEmit` limpo (zero erros novos nos arquivos do módulo). Doc completa em `docs/marketplace-ads-architecture.md`.

## Módulo de Ads Multicanal — Fase 2 (alertas inteligentes, Mercado Livre)

Segue a mesma autorização de escopo da Fase 1: implementação real só em Mercado Livre, arquitetura pronta para os demais canais sem retrabalho.

- **`AdsAlertingService`** (novo) avalia a MESMA `classifyCampaignHealth` que já alimenta o dashboard — nenhuma segunda regra de negócio. Só `CUSTO_PERDIDO` é alert-worthy.
- **Máquina de estado** (`determineAlertAction`, função pura em `domain/ads-metrics.ts`) via `AdsCampaign.lastAlertedTier` (novo campo): alerta uma vez quando a campanha degrada para `CUSTO_PERDIDO`, nunca repete enquanto continuar ruim, reseta quando recupera — evita tanto spam a cada sync de 2h quanto silêncio permanente após o primeiro alerta.
- Chamado por `AdsSyncOrchestrator` logo após persistir campanhas/métricas de cada tenant, em try/catch próprio — uma falha ao avaliar alertas nunca reverte um sync que já persistiu dado bom.
- Reaproveita o MESMO `ALERT_SERVICE` já usado pelas falhas técnicas de sync (não existe canal de "alerta de negócio" separado ainda) — `source`/`severity` diferenciam o tipo de alerta; a porta permite trocar console por Slack/e-mail no futuro sem tocar em quem emite.
- **Schema Prisma:** `AdsCampaign.lastAlertedTier`/`lastAlertedAt` (novo enum `AdsCampaignHealthTier`, espelha o tipo de domínio), migração hand-written em `prisma/migrations/20260713190000_ads_alert_state/`.
- **Gap honesto:** sem endpoint de leitura de alertas ainda (só visíveis via `ALERT_SERVICE`/log estruturado) — incremento futuro natural para o frontend, não implementado nesta fatia.

Doc atualizada em `docs/marketplace-ads-architecture.md`, seção 7.

## Módulo de Ads Multicanal — Fase 3 (automação de escrita com Safety Lock, Mercado Livre)

Primeira ação de escrita do sistema contra um marketplace de Ads — e a única regra de negócio inegociável é o Safety Lock: **nenhuma chamada de escrita acontece sem confirmação explícita de um usuário ADMIN autenticado**. O sistema sugere, nunca aplica sozinho.

- **`AdsActionCapableProvider`** (novo, `shared/contracts/marketplace-provider.contract.ts`) — interface irmã de `AdsCapableProvider` (nenhuma estende a outra, mesmo racional de `PriceUpdateCapableProvider` no Pricing Intelligence). `MercadoLivreAdsProvider` implementa as duas; `pauseCampaign` chama `PUT .../product_ads/campaigns/:id`.
- **Fila de aprovação `AdsActionSuggestion`** (schema `marketplace_ads`, novo): máquina de estado `PENDING → CONFIRMED → APPLIED/FAILED` ou `PENDING → REJECTED`. Criada automaticamente por `AdsAlertingService` (Fase 2) no MESMO evento que já dispara o alerta (`shouldSuggestPauseAction` usa a mesma condição de `determineAlertAction === 'ALERT'`) — nunca uma segunda regra paralela. Idempotente: não empilha uma segunda sugestão aberta para a mesma campanha enquanto a anterior não foi decidida.
- **`AdsActionDispatcherService`** (novo) é o ÚNICO lugar do sistema que efetivamente chama uma ação de escrita contra um marketplace — e só em resposta a uma chamada HTTP explícita (`confirmAndApply`/`reject`), nunca por conta própria. Falha do provider nunca lança exceção: marca `FAILED` com motivo e emite alerta `ERROR` no mesmo `ALERT_SERVICE` do resto do módulo.
- **Endpoints** (`AdsActionsController`, `JwtAuthGuard`+`RolesGuard`): `GET /marketplace-ads/actions/pending`, `POST /marketplace-ads/actions/:id/confirm` (`@Roles(ADMIN)`), `POST /marketplace-ads/actions/:id/reject` (`@Roles(ADMIN)`) — `@CurrentUser()` audita quem confirmou/rejeitou.
- **Schema Prisma:** `AdsActionSuggestion` (enums `AdsActionType`, `AdsActionStatus`), migração hand-written em `prisma/migrations/20260716120000_ads_action_suggestions/`.
- **Extensibilidade:** um canal novo pode implementar só leitura (`AdsCapableProvider`) sem escrita — `AdsActionDispatcherService` simplesmente marca a sugestão como `FAILED` com mensagem explícita se não achar um provider `ADS_ACTIONS`-capable para o canal, nunca falha silenciosamente.

Testes: `ads-metrics.spec.ts` (14, incluindo `shouldSuggestPauseAction`), `mercado-livre-ads.provider.spec.ts` (14, incluindo `pauseCampaign`), `ads-sync-orchestrator.service.spec.ts` (10), `ads-insights.service.spec.ts` (3), `ads-alerting.service.spec.ts` (9), `ads-action-dispatcher.service.spec.ts` (9, novo) — 59 testes, todos passando. `tsc --noEmit` limpo (zero erros novos além da limitação de sandbox já documentada — Prisma Client não gerado). Doc atualizada em `docs/marketplace-ads-architecture.md`, seções 9-11.

## Módulo de Ads Multicanal — Fase 4 (sugestão via IA, opcional)

Pipeline de sugestão de otimização de campanha assistido por IA (Anthropic/Claude) — irmão do caminho determinístico da Fase 2, nunca uma substituição dele. `AdsActionDispatcherService` (Fase 3, Safety Lock) **não foi tocado nesta fase**: continua sendo o único lugar do sistema que efetivamente chama uma ação de escrita, sempre atrás de confirmação humana explícita, com ou sem IA envolvida.

- **`AdsAiOptimizationService`** (novo, `marketplace-ads/application`) — busca campanhas elegíveis (`tier !== 'SEM_DADOS'`) via `AdsInsightsService.getDashboard` (MESMA fonte do dashboard visual, nenhuma segunda leitura de métrica), chama a porta `CampaignOptimizationAdvisor`, filtra por `ADS_AI_MIN_CONFIDENCE` (padrão 0.6) e por idempotência (`findOpenSuggestion`), e cria `AdsActionSuggestion` `PENDING` com `source: 'AI'` pelo MESMO repositório da Fase 2/3 (`ADS_ACTION_SUGGESTION_REPOSITORY`) — nunca aplica nada sozinho.
- **`CampaignOptimizationAdvisor`** (porta, `shared/contracts/`) + **`AnthropicCampaignAdvisor`** (adapter, `marketplace-ads/infrastructure/ai/`) — chamada via `fetch` puro contra a API da Anthropic (sem `@anthropic-ai/sdk`, mesmo estilo de `MercadoLivreApiClient`/`NuvemshopApiClient`), *structured output* via tool-use (JSON Schema forçado, nunca "peça JSON no prompt e faça regex depois"). Segunda camada de validação de CONTEÚDO (`validateSuggestion`) depois da validação de FORMA da própria Anthropic: `campaignId` precisa pertencer à lista enviada, `actionType` precisa estar em `SUPPORTED_ACTION_TYPES`, `reasoning` precisa ter um número concreto, `confidenceScore` precisa estar em [0,1] — sugestão inválida é descartada (logada), nunca lançada como exceção fatal.
- **Meta de ROAS por tenant** (`CatalogSettings.targetRoas`, `Float?` nullable) com fallback para uma constante global (`DEFAULT_TARGET_ROAS = 3`) resolvido em UM ÚNICO lugar (`FinancialPolicyReaderService.getPolicy`) — mesmo padrão já usado por `taxRate`/`minProfitMargin`: "flexibilidade com valor padrão" pedida explicitamente pelo usuário, nunca força configuração imediata para todo tenant.
- **Escopo de ação desta fase: só `PAUSE_CAMPAIGN`** (decisão explícita do usuário, priorizando estabilidade do Safety Lock sobre cobertura de ações) — sem bloqueio arquitetural para adicionar `REDUCE_BID`/`INCREASE_BUDGET` depois; `AdsActionSuggestion.metadata Json?` já existe desde já como ponto de extensão para parâmetros de ações futuras, sem nova migração.
- **Cron separado** (`AdsAiOptimizationSchedulerJob`, `EVERY_DAY_AT_6AM`) do ciclo de 2h de sync de métricas — chamada de LLM tem custo/latência que sync não tem; o alerta determinístico (Fase 2, barato, roda a cada 2h) já cobre o caso urgente.
- **Auditoria reaproveitada**, zero schema novo: `ProviderSyncLogRepository`/`ProviderHealthRepository` (MESMA infra genérica de todo provider de sync) registram cada execução com `providerCode: 'ADS_AI_ADVISOR'`; falha nunca propaga — emite alerta `WARNING` (degradação de feature opcional, não falha de sistema núcleo) e o ciclo termina, sem retry no mesmo dia.
- **Schema Prisma:** `AdsActionSuggestion.source` (enum `AdsActionSource: RULE_BASED | AI`), `.confidenceScore Float?`, `.metadata Json?`; `CatalogSettings.targetRoas Float?` — migração hand-written em `prisma/migrations/20260716140000_ads_ai_optimization/`.
- **Config:** `ANTHROPIC_API_KEY` (obrigatória se o adapter Anthropic estiver ativo, falha explícita via `requireAiEnv` se ausente — nunca um fallback silencioso), `ADS_AI_MODEL` (padrão `claude-sonnet-4-5`), `ADS_AI_MIN_CONFIDENCE` (padrão `0.6`) — ver `.env.example`.

Testes: `anthropic-campaign-advisor.service.spec.ts` (10, novo — chave ausente, lista vazia, happy path, 4 rejeições de validação, HTTP de erro, resposta sem tool_use), `ads-ai-optimization.service.spec.ts` (9, novo — sem elegíveis, happy path, confidence abaixo do mínimo default/customizado, idempotência, campaignId fora do conjunto elegível, falha da IA nunca relança, `runAll`), `financial-policy-reader.service.spec.ts` (6, estendido — fallback de `targetRoas`) — 78 testes no módulo `marketplace-ads` (todos passando), mais os testes de `catalog`/`pricing-intelligence`/`promotion-intelligence` afetados pela mudança de assinatura de `FinancialPolicy` (todos verdes). `tsc --noEmit` limpo (zero erros novos além da limitação de sandbox já documentada — Prisma Client não gerado, `class-validator` sem `.d.ts`). Doc completa em `docs/marketplace-ads-ai-fase4-architecture.md`; doc geral do módulo atualizada em `docs/marketplace-ads-architecture.md`, seção 12.

## Sprint de Layout/UI — Bloco 1: Dashboard de Ads + Demo Mode

Primeiro bloco do sprint de Layout/UI (ver seção "Fase 0 — EM STANDBY" acima) — prioridade total pedida pelo usuário, com dois requisitos explícitos: (1) Demo Mode perfeitamente integrado ao módulo de Ads, já que a qualidade dos dados fictícios é peça-chave para as auditorias de segurança da Amazon/Shopee que vão retomar a Fase 0; (2) no card de sugestão, `reasoning` e `confidenceScore` da IA em destaque, para que a confirmação humana seja consciente e rápida.

- **Demo Mode no módulo de Ads (gap fechado nesta sprint)** — até aqui só `Order` tinha `isDemo`; `AdsCampaign`/`AdsMetricSnapshot`/`AdsActionSuggestion` não tinham nenhum suporte a Audit Mode. Mesmo padrão de `Order.isDemo`: `AdsCampaign.isDemo Boolean @default(false)` (só na entidade-pai; `AdsMetricSnapshot`/`AdsActionSuggestion` são filtrados transitivamente via join com a campanha, nunca com campo próprio). `dataMode` roteado por toda a cadeia de leitura: `AdsInsightsService.getDashboard`, `AdsActionDispatcherService.listPending`, `AdsCampaignRepository.listCampaigns/sumMetricsByCampaign`, `AdsActionSuggestionRepository.listPending` — `mode` como query param solto (`'REAL'|'DEMO'`, ausente = `'REAL'`), mesmo padrão de `OrdersController`.
- **`AdsAuditSeederService`** (novo, `marketplace-ads/application`) — mesmo racional do `AuditSeederService` (Orders): fala direto com os repositórios (`seedDemoCampaign`/`seedDemoMetricSnapshot`/`deleteDemoCampaigns`/`countDemoCampaigns`/`deleteDemoSuggestions`, novos métodos dedicados a Demo Mode, nunca reaproveitando o contrato de sync real `RawAdsCampaignCandidate` — a ausência do campo `isDemo` nesse tipo é a garantia de que nenhum provider real grava campanha demo por engano). Semeia 4 campanhas fixas (`DEMO-ADS-CAMP-001..004`, canal Mercado Livre — único canal de Ads real hoje) cobrindo os 3 tiers que importam para demonstração (ESTRELA, PONTO_DE_ATENCAO, CUSTO_PERDIDO ×2) e as 2 origens de sugestão (`RULE_BASED` e `AI`, esta com `reason`/`confidenceScore`/`metadata` no mesmo estilo do que `AnthropicCampaignAdvisor` devolveria de verdade) — idempotente via chave de negócio fixa + `findOpenSuggestion` antes de criar.
- **`AdsAuditModeController`** (`GET/POST /marketplace-ads/audit-mode/{status,seed,clear}`, ADMIN-only) — endpoint dedicado do módulo (não reaproveita `/audit-mode` de Orders, por coesão de módulo). `AppModeToggle.tsx` (frontend) agora chama Orders e Ads juntos num único clique de "Semear dados de demonstração" — um tenant pronto pra demo inteiro, não dois botões que alguém pode esquecer de acionar junto.
- **Frontend — `features/ads/`** — `api.ts` (tipos espelhando o backend + `fetchAdsDashboard`/`fetchPendingAdsActions`/`confirmAdsAction`/`rejectAdsAction`), `tier-meta.ts` (cor por tier, mesmo racional de `severity-meta.ts`), `components/AdsCampaignCard.tsx` (ROAS + tier + recomendação), `components/AdsSuggestionCard.tsx` — o card pedido: `reason` (o `reasoning`) é o bloco tipográfico PRINCIPAL do card (`font-serif`, texto maior, fundo destacado), `confidenceScore` só aparece pra origem `AI` como número grande + barra de progresso dentro de um contêiner com o acento neon (reservado no design system exatamente para "insight de IA, estado que pede atenção consciente" — nunca usado como cor de texto padrão), metadata fica secundária/colapsável. Confirmar/Rejeitar só aparecem para quem `canToggle` (mesmo papel ADMIN do Audit Mode).
- **`AdsPage.tsx`** (nova rota `/ads`, item "Ads" na Sidebar) — hero + KPIs (investido, receita ads, ROAS agregado, TACOS) + seção de sugestões pendentes (quando existir) + grade de campanhas.
- **Escopo consciente:** só Mercado Livre tem Ads real hoje (Fases 1-4 do backend); a página não esconde isso — o `ChannelBadge` de cada campanha mostra o canal de verdade, inclusive nos dados de demonstração.

Verificação: `tsc --noEmit` do backend (sandbox) — 249 erros, todos na mesma categoria de baseline já documentada (Prisma Client não gerado nesta sandbox, rede bloqueada) mais 8 ocorrências novas da MESMA categoria proporcional ao código novo (mais chamadas a `prisma.adsCampaign`/`adsMetricSnapshot`/`adsActionSuggestion`), zero categoria nova. `tsc --noEmit` do frontend: **zero erros**. Schema: migração hand-written em `prisma/migrations/20260716180000_ads_demo_mode/` (mesmo aviso de honestidade de toda migração manual deste projeto — precisa `prisma migrate deploy` numa máquina com rede real).

## Política de Preço Mínimo (MAP) — governança de preço do fornecedor

Garante estruturalmente que o Kyneti nunca envia ao marketplace um preço abaixo do MAP (Preço Mínimo Anunciado) definido pelo fornecedor/marca — pedido explícito do usuário, "em hipótese alguma". **Correção de premissa registrada no doc de arquitetura:** o pedido assumia um "sistema de auditoria existente" — não havia nenhum mecanismo genérico de "quem mudou o campo X, quando" antes desta política; `ProductAuditLog` é um mecanismo novo, deliberadamente escopado a campos de governança do `Product` (hoje só `mapPrice`), não um audit log universal.

- **`Product.mapPrice`** (`Decimal? @db.Decimal(12, 2)`) — nullable, `null` = sem restrição MAP. Não é campo espelhado do ERP (editável em qualquer `sourceSystem`) — é política comercial, não dado físico.
- **Trava em três camadas, defesa em profundidade** (mesmo padrão já usado para o piso financeiro de tenant, Etapa 13): (1) `DefaultPricingStrategist` inclui `mapPrice` no `Math.max` dos três pisos — vence empate com os outros dois de propósito (contratual > margem interna); (2) `PricingDecisionService.resolveDecision` faz um recheck independente usando `product.mapPrice` direto, protegendo contra um `PricingStrategist` customizado futuro que erre o piso; (3) **gate final** — `validatePriceAgainstMap` chamado por `PricingDecisionService.dispatchDecision` imediatamente antes de `priceUpdateDispatcher.dispatch()`, o único funil de escrita (manual e automático). Em condições normais nunca dispara; lança `MapPriceViolationError`, capturada e convertida em resultado de negócio (`applied: false`), nunca um 500 não tratado — mas logada em ERROR por ser uma anomalia.
- **`ProductAuditLog`** (novo modelo) — `diffGovernanceFields` (função pura) compara o valor atual persistido contra o input, distinguindo `undefined` ("não tocado") de `null` explícito ("limpar o MAP", uma mudança real). `ProductAuditLogService.record` é chamado por `ProductsService.update()` só DEPOIS que o update persiste com sucesso. `ProductUpdateActor { userId, source? }` agora obrigatório em `update()`. Endpoint `GET /products/:id/audit-log` (ADMIN).
- **Importação em massa** — `POST /products/bulk-import/map-price` (ADMIN), CSV cru (`sku_code,map_price`) como texto no corpo JSON, não multipart (convenção já usada por `ImportSettlementDto`; projeto evita `FileInterceptor` em todo o código). Política **tudo-ou-nada**: qualquer linha com erro de formato ou SKU inexistente bloqueia a importação inteira — evita deixar o catálogo num estado parcialmente atualizado numa política de preço mínimo, onde o erro custa dinheiro/contrato. Reaproveita `ProductsService.update()` linha a linha com `source: 'BULK_IMPORT'` — mesmo funil de auditoria do caminho manual, garantindo que a importação em massa nunca pode escrever `mapPrice` sem deixar rastro.
- **Schema Prisma:** `Product.mapPrice`, `ProductAuditLog` + `ProductAuditSource` — migração hand-written em `prisma/migrations/20260716160000_map_price_governance/`.

Testes: `default-pricing-strategist.spec.ts` (5 casos novos — MAP mais restritivo vence, MAP mais frouxo não é acionado, empate com piso financeiro, `mapPrice: null`, `mapPrice <= 0` rejeitado), `pricing-decision.service.spec.ts` (6 casos novos — recheck de camada 2, `applyDecision` aplica o preço corrigido, gate final bloqueia o dispatcher mesmo com uma decisão que escapou das camadas anteriores), `product-audit.spec.ts` (6, novo — `diffGovernanceFields`), `product-audit-log.service.spec.ts` (6, novo), `map-price-import-row-parser.spec.ts` (10, novo), `bulk-map-price-import.service.spec.ts` (6, novo) — 92 testes passando neste sandbox. Fixtures pré-existentes ajustadas (`promotion-intelligence`, `orders`, `logistics-fulfillment`, `catalog`) pela mudança de assinatura de `PricingContext`/`PricingDecision`/`ProductCatalogSummary`/`ProductsService.update`. `tsc --noEmit`: mesmos 241 erros de baseline pré-existentes em todo o projeto (Prisma Client não gerado, `class-validator` sem `.d.ts`, `S3Client.send`), zero categoria nova introduzida pelo MAP. `products.service.spec.ts` e `bulk-map-price-import.service.spec.ts` herdam o gap já documentado de `ProductsService` importar `Prisma` diretamente (não compilam neste sandbox por essa razão pré-existente, não por erro de lógica). Doc completa em `docs/map-price-governance-architecture.md`.

## Sprint de Layout/UI — Bloco 2: Governança de MAP + Promoções

Segundo bloco do sprint de Layout/UI (ver Bloco 1 acima). Backend de ambas as features já existia por inteiro (Política de MAP e Sprint 26 — Motor de Cálculo de Margem, ambas documentadas nas seções anteriores) — este bloco é puramente frontend, construindo a UI sobre contratos já estáveis.

- **`features/catalog/api.ts` (estendido)** — `Product.mapPrice` adicionado à interface; `updateProductMapPrice` (`PATCH /products/:id`, só o campo `mapPrice`, mesmo que o backend aceite qualquer subconjunto), `fetchProductAuditLog` (`GET /products/:id/audit-log`) e `bulkImportMapPrice` (`POST /products/bulk-import/map-price`, CSV cru como texto, mesma convenção de `ImportSettlementDto` — sem `FileInterceptor`).
- **`routes/MapGovernancePage.tsx`** (nova rota `/governanca-map`) — tabela de produtos com edição inline de `mapPrice` (`null` = sem restrição, campo em branco remove a trava), trilha de auditoria expansível por linha (`ProductAuditTrail.tsx`) e painel de importação em massa (`MapBulkImportPanel.tsx`, política tudo-ou-nada do backend refletida sem tentar "consertar" nada no cliente — lista de erros exibida como veio). Gating espelha os guards do backend exatamente: edição = ADMIN + PRICING_EDITOR; trilha de auditoria e importação em massa = ADMIN only.
- **`features/promotions/api.ts`** (novo) — tipos espelhando `PromotionCampaign`/`PromotionEnrollment`/`MarginPreview`/`MarginStatus` do backend + `fetchPromotionCampaigns`/`fetchPromotionCampaign`/`createPromotionCampaign`/`previewCampaignMargin`/`enrollSkuInCampaign`/`fetchCampaignEnrollments`.
- **`routes/PromotionsPage.tsx`** (nova rota `/promocoes`) — lista de campanhas (`ChannelBadge` reaproveitado de `features/orders/channels.ts`, `CampaignStatusBadge` novo) + `CreateCampaignPanel.tsx` (ADMIN + PRICING_EDITOR) para criar campanha por canal/período.
- **`routes/PromotionCampaignDetailPage.tsx`** (nova rota `/promocoes/:campaignId`) — **Semáforo de Margem** (`MarginPreviewSimulator.tsx`): simula a margem líquida de um SKU nesta campanha via `GET .../margin-preview` (leitura pura, nada é gravado) antes de decidir inscrever; badge VERDE/VERMELHO + breakdown (custo, taxas, imposto, logística) + alerta quando `feeRuleFound: false` (taxa assumida como zero, margem pode estar otimista). Botão "Inscrever" (ADMIN + PRICING_EDITOR) chama `POST .../enrollments` — a Validação Proativa de verdade acontece aqui: o backend recalcula do zero e sempre grava um snapshot (`APPROVED` ou `BLOCKED`, nunca `PENDING`), sempre responde 201 mesmo bloqueado (bloqueio é dado de negócio, não erro de requisição) — a UI mostra o `blockedReason` tal como veio. `EnrollmentTable.tsx` lista os snapshots já calculados.
- **Rotas + Sidebar** — `/governanca-map` ("Governança MAP") e `/promocoes` + `/promocoes/:campaignId` ("Promoções") adicionados ao `App.tsx` e à `Sidebar.tsx`, entre "Produtos" e "Financeiro".

Verificação: `tsc --noEmit` do frontend — **zero erros**. Nenhuma mudança de backend neste bloco (endpoints já existiam e são estáveis), então nenhuma verificação de backend/testes Jest era necessária.

## Sprint de Layout/UI — Bloco 3: Configurações Fiscais

Terceiro e último bloco do sprint de Layout/UI (ver Blocos 1 e 2 acima). A tela de Configurações Fiscais era um `ComingSoonPage` que cogitava a hipótese de faltar CRUD de escrita no backend — investigação confirmou que **não faltava nada**: `TaxProfile` já tinha CRUD completo (`POST/GET/PATCH/DELETE /tax-profiles`) e `CatalogSettings` já tinha as duas rotas de escrita (`PUT /catalog/settings` para margens padrão por SKU, `PUT /catalog/settings/financial-policy` para o piso financeiro global + meta de ROAS). Bloco puramente frontend, como os dois anteriores.

- **`features/tax-profiles/api.ts`** (novo) — tipos espelhando `TaxProfile`/`TaxRegime` do backend + `fetchTaxProfiles`/`createTaxProfile`/`updateTaxProfile`/`deleteTaxProfile`.
- **`features/catalog-settings/api.ts`** (novo) — dois pares de leitura/escrita conscientemente separados, espelhando a separação do backend: `fetchDefaultMargins`/`updateDefaultMargins` (`desiredMarginPct`/`minimumMarginPct`) e `fetchFinancialPolicy`/`updateFinancialPolicy` (`taxRatePct`/`minProfitMarginPct`/`targetRoas` opcional — omitir o campo no PUT não altera o valor já salvo, mesmo comportamento parcial do backend).
- **`routes/ConfiguracoesFiscaisPage.tsx`** (substituiu o `ComingSoonPage`) — três seções empilhadas: `TaxProfilesSection.tsx` (tabela + criar/editar/excluir, com confirmação inline antes de excluir), `DefaultMarginsForm.tsx` e `FinancialPolicyForm.tsx`. Gating único e consistente nas três: leitura para qualquer papel autenticado, edição só para `ADMIN` (mesmo `@Roles(ADMIN)` do backend em todo endpoint de escrita) — quando o usuário não é ADMIN, os campos aparecem desabilitados (`disabled`) em vez de escondidos, para que ele veja os valores configurados sem poder alterá-los.
- **Sem mudança de rota/Sidebar** — `/configuracoes-fiscais` já existia desde o Etapa 7 como item de menu; só o conteúdo da página mudou.

Verificação: `tsc --noEmit` do frontend — **zero erros**. Nenhuma mudança de backend neste bloco (TaxProfile e CatalogSettings já tinham CRUD/escrita completos), então nenhuma verificação de backend/testes Jest era necessária. Com isso, o sprint de Layout/UI (Blocos 1-3) está concluído.

## Correções de build/testes (revisão pós-diagnóstico)

Duas correções pontuais encontradas durante uma revisão do estado de build/testes do projeto: (1) `products.service.ts` importava `Prisma.PrismaClientKnownRequestError` (via `typeof Prisma`) — quebra em qualquer sandbox onde o Prisma Client não foi gerado (`prisma generate` não rodou), porque o `.d.ts` gerado fica sem reexportar essa classe no namespace `Prisma`; trocado para importar `PrismaClientKnownRequestError` direto de `@prisma/client/runtime/library`, que independe do client ter sido gerado. (2) `ads-action-dispatcher.service.spec.ts`: o teste de `listPending` ficou desatualizado quando `dataMode` foi roteado por esse método (Bloco 1, Demo Mode em Ads) — o service sempre repassa dois argumentos posicionais ao repositório (`listPending(tenantId, dataMode)`), então sem `dataMode` explícito o mock recebe `('tenant-1', undefined)`, não só `'tenant-1'`; assert corrigido + caso novo cobrindo `dataMode` explícito. Achado também: dois arquivos (`products.service.ts`, `marketplace-ads.module.ts`) estavam truncados no espelho do sandbox de execução (bug de sincronização do ambiente, não do código-fonte) — resincronizados.

## Row-Level Security (RLS) — migração aplicada, isolamento validado, falta apontar o Render para o role certo

Prioridade #1 definida pelo usuário após a revisão de status: reforçar o isolamento multi-tenant no banco antes de qualquer funcionalidade nova — Ads Fase 0 e novos canais continuam em standby até esta frente fechar. Usuário autorizou explicitamente a implementação (leigo em infra, confiou na análise técnica), condicionado a não degradar performance nem travar acesso de clientes atuais — isso motivou manter a migração SQL como arquivo separado e manual, nunca auto-aplicada.

**Estado atual (checklist completo em `docs/row-level-security-architecture.md`, seção 0):**
- **Código da aplicação: implementado.** `TenantContextStore` (`AsyncLocalStorage`), `PrismaService` reescrito como token de tipo + client real injetado via `useValue` (Prisma Client Extension com `set_config(..., true)` dentro do mesmo `$transaction`, sem tocar nenhum dos 32 repositórios existentes), `TenantContextInterceptor` global. Os 8 schedulers `@Cron` do projeto (Ads Sync, Ads AI Optimization, Orders Sync, Competition Monitor, Nuvemshop Sync, Erp Sync, Video Retention Cleanup, Marketplace Intelligence Sync) receberam o bypass mínimo no envelope externo; 4 orquestradores com loop tenant-a-tenant confirmado (Ads Sync, Ads AI Optimization, Orders Sync, Rule Sync — este último com o caso especial de regra global nula) reabrem o contexto correto por tenant a cada iteração, defesa em profundidade real e não só no nível do cron.
- **Migração SQL: escrita e aplicada.** `apps/api/prisma/manual-migrations/2026-07-17_enable_row_level_security.sql` (ida) + `2026-07-17_rollback_row_level_security.sql` (botão de desfazer) — deliberadamente **fora** de `prisma/migrations/`, para não ser pega automaticamente por um `prisma migrate deploy` futuro. Achado durante a escrita: o banco é multi-schema (13 schemas Postgres via Prisma `@@schema`, não um `public` único) — cada tabela na migração está qualificada (`"catalog"."products"`, `"orders"."orders"` etc.).
- **Testes unitários + tipagem: validados fora deste sandbox (ambiente com rede) — 466/466 testes passando (58 test suites) e `npx tsc --noEmit` sem erros em `apps/api`.** As 2 suítes E2E do Pick & Pack contra o banco com RLS já ativa continuam pendentes — verificação de integração adicional, não coberta pelos testes de unidade/tsc.
- **Isolamento cruzado validado empiricamente contra o Postgres real (Supabase) — com uma volta importante no meio do caminho.** Primeira tentativa (Tenant B autenticado tentando ler registro do Tenant A por ID direto, via `apps/api/test-rls.ts`, role de conexão `postgres`) **falhou**: o registro vazou. Causa, não coberta pelo desenho original: `FORCE ROW LEVEL SECURITY` só resolve o bypass do *dono da tabela* — não tem efeito sobre um role com o atributo `BYPASSRLS` (ou superusuário), e o `postgres` do Supabase tem privilégios equivalentes a isso (é por isso que até o SQL Editor do painel Supabase ignora RLS). Correção: `apps/api/prisma/manual-migrations/2026-07-22_create_app_runtime_role.sql` cria um role de aplicação dedicado, `app_runtime` — `NOBYPASSRLS`, `NOSUPERUSER`, só CRUD (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) nos 13 schemas via GRANT + `ALTER DEFAULT PRIVILEGES`. Repetindo o teste com `app_runtime`: **bloqueou corretamente** (0 linhas). Ver seção 3.4.1 (nova) de `docs/row-level-security-architecture.md` para o racional completo.
- **Pendente: produção ainda conecta com `postgres`.** O `.env` local já foi trocado para `app_runtime` (é o que passou no teste acima), mas o serviço `kyneti-api` no Render ainda usa `postgres` em `DATABASE_URL` — ou seja, a proteção real ainda não está ativa em produção, só localmente validada contra o mesmo banco. Falta: trocar essa env var no Render, redeploy, smoke test (login/dashboard) e medir latência nos endpoints de maior volume.

Achados principais do desenho original (ainda válidos): a aplicação conecta no Supabase via PgBouncer em modo *Transaction* (porta 6543), o que exige `set_config(..., true)` (equivalente a `SET LOCAL`) dentro da MESMA transação da query — um `SET` de sessão comum vazaria entre tenants por causa do reuso de conexão física do pooler. Risco que precisa de verificação empírica antes de confiar na proteção: RLS não vale para o dono da tabela por padrão no Postgres — por isso a migração usa `FORCE ROW LEVEL SECURITY` em toda tabela, mas o teste manual pós-deploy (autenticar como tenant A, tentar ler registro do tenant B pelo ID direto) continua obrigatório antes de considerar isto pronto. 30 tabelas recebem RLS (28 por coluna `tenantId` direta + 2 via subquery de FK), 6 ficam de fora por serem dado global/infraestrutura (`tenants`, `marketplaces`, `marketplace_change_events`, `provider_sync_schedules`, `provider_sync_logs`, `provider_health`), e `marketplace_rules` tem policy customizada (tenant opcional, regra global quando nulo).

## Design System — fundação shadcn/ui + Dark Mode (vitrine da marca)

Com a base de segurança (RLS) encaminhada, o usuário pediu para virar a atenção para a "cara" do sistema — um layout navegável para validar usabilidade e a lógica de negócio já implementada. Identidade definida pelo usuário: tons de cinza grafite como base, azul neon só como destaque, estética de "Dashboard de Inteligência" (sério/robusto/tecnológico, nada de referências a varejo/cosméticos), Dark Mode como padrão tecnológico com Light Mode como alternativa, shadcn/ui como biblioteca de componentes. Prioridade combinada com o usuário: `AppLayout` + `Dashboard` primeiro, como vitrine, antes de retrofitar as outras 9 telas já funcionais.

**Por que shadcn/ui, não uma biblioteca completa (MUI/Ant/Chakra):** o projeto já tinha ~11 páginas funcionais construídas com Tailwind puro e uma paleta Kyneti própria (`ink`/`canvas`/`surface`/`neon`/`gold`, Etapa 18) — uma biblioteca completa imporia design language própria e brigaria com esse investimento já feito. shadcn/ui não é uma dependência de runtime: são componentes Radix UI + Tailwind copiados para dentro do repo (sem CLI, escritos à mão nesta sessão por falta de acesso de rede/npm neste sandbox), então a paleta Kyneti vira a fonte dos tokens, não é substituída.

**Fundação (`apps/web`):**
- `package.json` — novas dependências: Radix primitives (`@radix-ui/react-avatar/dropdown-menu/separator/slot/tooltip`), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (ícones), `tailwindcss-animate` (dev).
- `tailwind.config.js` — `darkMode: ['class']`; paleta Kyneti nomeada mantida intacta (nenhum arquivo antigo quebra); tokens semânticos novos (`background`/`foreground`/`card`/`primary`/`secondary`/`muted`/`accent`/`destructive`/`border`/`input`/`ring`) referenciando CSS variables em formato `R G B` (suporta `bg-primary/60` etc.); `ink.950`/`ink.800` novos (grafite profundo do Dark Mode e superfície secundária).
- `src/styles/index.css` — blocos `:root` (Light) e `.dark` (Dark, padrão): `primary` é um neutro (chumbo no Light, quase-branco no Dark), nunca neon — neon fica reservado para anel de foco, indicador ativo, glow de KPI e acentos de gráfico, para não virar "vitrine neon" (pedido explícito: sério e tecnológico).
- `index.html` — script inline anti-flash que aplica `.dark` no `<html>` antes do React montar (lê `localStorage`, senão default `dark`).
- `src/features/theme/theme-context.tsx` (novo) — `ThemeProvider`/`useTheme()`, persiste em `localStorage`, dark como padrão.
- `src/lib/utils.ts` (novo) — `cn()` (clsx + tailwind-merge), helper padrão de todo componente shadcn.

**Primitivos (`src/components/ui/`, novos):** `button.tsx` (variantes `default/destructive/outline/secondary/ghost/link` + `accent` — extra do projeto, neon explícito, uso raro e deliberado), `card.tsx`, `badge.tsx` (variantes extras `success/warning/danger` reaproveitando a paleta `margin` já existente), `separator.tsx`, `skeleton.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, `avatar.tsx`.

**Retrofit (Sidebar/AppLayout/Dashboard — telas restantes ficam para a próxima rodada):**
- `Sidebar.tsx` — ícones lucide-react (abstratos/técnicos) no lugar dos SVGs hand-rolled; tokens semânticos (`bg-card`/`border-border`/`bg-primary`) resolvem Light/Dark sozinhos.
- `AppLayout.tsx` — toggle de tema (Sun/Moon) no header; menu de usuário via `DropdownMenu`+`Avatar` real, substituindo um botão de logout solto.
- `KpiCard.tsx`, `ChannelRoiList.tsx`, `AIInsightPanel.tsx` — migrados para `Card`; `DashboardPage.tsx` — `Skeleton` no lugar do texto "Carregando…", `Badge` no banner de Modo Demonstração (e a referência a "Rita Mazzei Beauty" no texto do banner foi generalizada para "dados reais do tenant" — identidade visual não deve carregar referência de varejo/cosméticos).
- `AppModeToggle.tsx` — o painel hand-rolled (`div` absoluta com estado `open` manual, sem fechar no Escape/clique fora, sem foco preso) virou `DropdownMenu` real — ganho de acessibilidade, não só visual.

**Pendente — bloqueado por falta de acesso de rede/bash neste sandbox, mesma limitação já registrada na frente de RLS:**
- `npm install` (nenhuma das dependências novas foi de fato instalada/baixada).
- `npx tsc --noEmit` e `npm run build` (Vite) do frontend — zero verificação de compilação feita nestes arquivos.
- Revisão visual real (abrir no navegador) — todo o trabalho foi código revisado estaticamente, nunca renderizado.

Próximo passo, assim que houver ambiente com rede: `npm install` em `apps/web`, `npx tsc --noEmit`, `npm run dev` para revisão visual do Dashboard nos dois temas, e só então seguir o retrofit para as 9 telas restantes (Pedidos, Ads, Catálogo, Governança MAP, Promoções, Financeiro, Abastecimento, Conferência, Integrações, Configurações Fiscais).
