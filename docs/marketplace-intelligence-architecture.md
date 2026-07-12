# Marketplace Intelligence — Arquitetura Enterprise

**Status:** proposta de arquitetura, aguardando confirmação antes da implementação em código.
**Escopo desta etapa:** framework completo e desacoplado, com apenas o adaptador do Mercado Livre funcional. Todo o restante do documento é desenhado para os 6 marketplaces (e outros futuros) sem exigir mudança no núcleo.

---

## 1. Objetivo e posicionamento do módulo

O `marketplace-intelligence` é o único lugar do sistema que sabe que Mercado Livre, Shopee, Amazon etc. existem como integrações concretas. Todo o resto do sistema — Pricing Engine, Dashboard, Repricing — enxerga apenas um contrato de leitura (`FeeRuleResolver` e equivalentes). Isso é **Ports & Adapters (arquitetura hexagonal)**: o "núcleo" (domínio de precificação) define a porta que precisa; cada marketplace é um adaptador que a implementa. Combinado com uma **Anti-Corruption Layer** em cada provider (a tradução do formato nativo de cada marketplace para um formato canônico interno), isso garante que uma mudança na API do Mercado Livre nunca vaza para fora do provider que a implementa.

Módulo interno, dentro do monólito modular (mantendo a decisão já tomada na Etapa 1 — não há motivo para extrair como serviço separado ainda), mas com fronteiras limpas o suficiente para ser extraído no futuro sem reescrita, caso o volume de sincronização algum dia justifique.

---

## 2. Modelo de dados

### 2.1 — Decisão de design: `Marketplace` é dado, não enum de código

A tentação óbvia é um `enum MarketplaceCode { MERCADO_LIVRE, SHOPEE, ... }` no Prisma. Rejeito essa opção conscientemente: um enum de banco exige migration toda vez que um marketplace novo entra, o que contradiz diretamente o objetivo de "adicionar marketplace sem alterar o núcleo". Em vez disso, `Marketplace` é uma tabela de referência simples:

```prisma
model Marketplace {
  id          String   @id @default(uuid())
  code        String   @unique // "MERCADO_LIVRE", "SHOPEE", ... — chave estável usada em todo o sistema
  displayName String
  isActive    Boolean  @default(true) // existe no catálogo, mesmo sem provider funcional ainda
  createdAt   DateTime @default(now())

  @@map("marketplaces")
}
```

Adicionar a Amazon no futuro = inserir uma linha nessa tabela + implementar um provider. Zero migration de schema. Isso é diferente de `RuleType`, `DataSourceType`, `RuleStatus` e `ProviderCapability` abaixo, que **continuam como enums Prisma** — são vocabulário técnico fechado, definido pela arquitetura do sistema, não dado de negócio que cresce com o catálogo de marketplaces. Vale registrar essa distinção porque é fácil errar para os dois lados (enumerar demais o que devia ser dado, ou tratar como dado o que devia ser tipo).

### 2.2 — `MarketplaceRule`: tabela única e versionada para qualquer tipo de regra

Em vez de uma tabela por tipo de informação (`FeeRule`, `ShippingPolicy`, `CategoryTaxonomy`, e qualquer tipo futuro), uso **uma tabela genérica com payload flexível**, porque a mecânica de versionamento/status/auditoria é idêntica para qualquer tipo de regra de marketplace — só o conteúdo muda. Isso significa que adicionar um novo *tipo* de informação (ex.: "critérios de elegibilidade de Buy Box", que hoje nem existe no sistema) não exige tabela nova nem migration — só um novo valor de `ruleType` e um validador de payload correspondente na camada de aplicação.

```prisma
enum RuleType {
  FEE_RULE            // comissão, taxa fixa, tarifas
  SHIPPING_POLICY      // regras de frete grátis, subsídio por peso/faixa
  CATEGORY_TAXONOMY    // mapeamento de categoria externa -> interna
}

enum DataSourceType {
  OFFICIAL_API
  OFFICIAL_DOCS
  IMPORTED_FILE
  MANUAL
}

enum RuleStatus {
  PENDENTE_VALIDACAO
  VALIDADA
  DESATUALIZADA
  OBSOLETA
}

model MarketplaceRule {
  id            String      @id @default(uuid())

  marketplaceId String
  marketplace   Marketplace @relation(fields: [marketplaceId], references: [id])

  ruleType      RuleType

  // Chave de escopo normalizada dentro do ruleType — para FEE_RULE é o código
  // de categoria externa; para SHIPPING_POLICY é o identificador da política;
  // para CATEGORY_TAXONOMY é o código da categoria interna mapeada.
  scopeKey      String

  // Conteúdo validado por schema específico do ruleType na camada de aplicação
  // (não no banco) antes de gravar — ver seção 3.4.
  payload       Json

  version       Int         // monotônico dentro de (marketplaceId, ruleType, scopeKey, tenantId)
  status        RuleStatus  @default(PENDENTE_VALIDACAO)

  // Override manual sempre vence conflito, independente da prioridade de
  // fonte (ver seção 6). Não é a mesma coisa que "fonte = MANUAL": um humano
  // pode revisar e confirmar (pin) um dado que veio de outra fonte também.
  pinned        Boolean     @default(false)

  sourceType        DataSourceType
  sourceProviderCode String     // ex.: "MERCADO_LIVRE_API_V1"
  sourceFetchedAt    DateTime
  sourceEvidenceRef  String?    // URL da doc, nome do arquivo importado, ou userId de quem cadastrou

  contentHash   String      // hash do payload normalizado — usado para diff/dedupe no pipeline de sync

  effectiveFrom DateTime
  effectiveTo   DateTime?

  validatedById String?
  validatedAt   DateTime?

  // null = regra global da plataforma (ex.: tabela pública de comissão do ML).
  // preenchido = override específico de um tenant (negociação, correção pontual).
  // Ver seção 6 — a maioria das regras nasce global; overrides são exceção.
  tenantId      String?

  createdAt     DateTime    @default(now())

  @@unique([marketplaceId, ruleType, scopeKey, version, tenantId])
  @@index([marketplaceId, ruleType, scopeKey, status])
  @@map("marketplace_rules")
}
```

**Trade-off assumido conscientemente:** JSONB tira type-safety no nível do banco — não dá pra fazer `WHERE payload.commissionPct > 15` com a mesma naturalidade de uma coluna tipada. Mitigo isso de duas formas: (a) validação de schema por `ruleType` acontece sempre na camada de aplicação antes de persistir (seção 3.4), então o payload gravado é sempre estruturalmente confiável; (b) se no futuro surgir necessidade real de consulta analítica pesada sobre um campo específico do payload, o Postgres permite índice em expressão JSONB (`CREATE INDEX ON marketplace_rules ((payload->>'commissionPct'))`) sem precisar migrar a tabela — o custo dessa decisão é adiável, não é dívida técnica que trava o futuro.

### 2.3 — Histórico de mudanças (o que alimenta o painel)

```prisma
enum ChangeResolution {
  AUTO_APPLIED
  PENDING_REVIEW
  REJECTED
  APPLIED_MANUALLY
}

model MarketplaceChangeEvent {
  id                  String            @id @default(uuid())
  marketplaceId       String
  marketplace         Marketplace       @relation(fields: [marketplaceId], references: [id])
  ruleType            RuleType
  scopeKey            String

  previousRuleId      String?
  newRuleId           String

  changeSummary       String            // diff legível, gerado automaticamente (ver 5.3)
  detectedByProvider  String
  detectedAt          DateTime          @default(now())

  resolutionStatus    ChangeResolution  @default(PENDING_REVIEW)
  reviewedById        String?
  reviewedAt          DateTime?

  @@index([marketplaceId, detectedAt])
  @@map("marketplace_change_events")
}
```

### 2.4 — Orquestração e observabilidade da sincronização

```prisma
model ProviderSyncSchedule {
  id               String   @id @default(uuid())
  providerCode     String   @unique
  marketplaceId    String
  marketplace      Marketplace @relation(fields: [marketplaceId], references: [id])
  capability       String   // "FEE_RULES" | "SHIPPING_POLICY" | "CATEGORY_TAXONOMY"
  intervalMinutes  Int      // frequência de polling — configurável sem redeploy
  isEnabled        Boolean  @default(true)
  autoTrust        Boolean  @default(false) // se true, candidatos são promovidos direto a VALIDADA
  lastRunAt        DateTime?
  lastRunStatus    String?

  @@map("provider_sync_schedules")
}

model ProviderSyncLog {
  id                String   @id @default(uuid())
  providerCode      String
  correlationId     String
  startedAt         DateTime @default(now())
  finishedAt        DateTime?
  status            String   // SUCCESS | FAILED | PARTIAL
  candidatesFound   Int      @default(0)
  candidatesApplied Int      @default(0)
  errorDetails      String?

  @@index([providerCode, startedAt])
  @@map("provider_sync_logs")
}

model ProviderHealth {
  providerCode        String   @id
  status              String   // UP | DEGRADED | DOWN
  consecutiveFailures Int      @default(0)
  lastSuccessAt       DateTime?
  lastFailureAt       DateTime?
  lastError           String?
  updatedAt           DateTime @updatedAt

  @@map("provider_health")
}
```

Três registros, três públicos diferentes — decisão deliberada de não misturar tudo numa tabela só: `MarketplaceRule` é o registro de negócio (o que é verdade e desde quando), `MarketplaceChangeEvent` é o registro de produto (o que mudou, alimenta o painel que você vai olhar), `ProviderSyncLog`/`ProviderHealth` é o registro de operação (o time técnico usa pra depurar por que uma sincronização falhou). Tentar unificar os três de propósito diferente é o motivo mais comum de um log virar inconsultável com o tempo.

---

## 3. Contratos (interfaces TypeScript)

### 3.1 — Vocabulário base

```typescript
export enum ProviderCapability {
  FEE_RULES = 'FEE_RULES',
  SHIPPING_POLICY = 'SHIPPING_POLICY',
  CATEGORY_TAXONOMY = 'CATEGORY_TAXONOMY',
  AUTH = 'AUTH',
}

export interface RawRuleCandidate {
  scopeKey: string;
  payload: unknown; // validado pelo normalizer do ruleType antes de persistir
  sourceEvidenceRef?: string;
  fetchedAt: Date;
}

export interface FetchContext {
  marketplaceCode: string;
  tenantId?: string; // presente só quando a captura depende de credencial do vendedor
  since?: Date;       // sync incremental, quando o provider suportar
}

export interface ProviderHealthStatus {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  message?: string;
}
```

### 3.2 — Contrato de provider (Interface Segregation: cada provider só implementa o que sabe fazer)

```typescript
// Todo provider implementa isso, no mínimo.
export interface MarketplaceProvider {
  readonly code: string;              // ex.: "MERCADO_LIVRE_API_V1"
  readonly marketplaceCode: string;   // ex.: "MERCADO_LIVRE"
  readonly sourceType: 'OFFICIAL_API' | 'OFFICIAL_DOCS' | 'IMPORTED_FILE' | 'MANUAL';
  readonly capabilities: ProviderCapability[];
  healthCheck(): Promise<ProviderHealthStatus>;
}

export interface FeeRuleCapableProvider extends MarketplaceProvider {
  fetchFeeRules(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface ShippingPolicyCapableProvider extends MarketplaceProvider {
  fetchShippingPolicies(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface CategoryTaxonomyCapableProvider extends MarketplaceProvider {
  fetchCategoryTaxonomy(ctx: FetchContext): Promise<RawRuleCandidate[]>;
}

export interface AuthenticatedProvider extends MarketplaceProvider {
  readonly authScope: 'PLATFORM' | 'TENANT';
  ensureValidCredentials(tenantId?: string): Promise<void>;
}
```

Um provider real normalmente implementa mais de uma dessas interfaces. `MercadoLivreApiProvider`, por exemplo, implementa `FeeRuleCapableProvider`, `CategoryTaxonomyCapableProvider` e `AuthenticatedProvider` ao mesmo tempo — TypeScript permite isso naturalmente com `implements A, B, C`.

### 3.3 — Estratégia de autenticação

```typescript
export interface AuthStrategy {
  readonly type: 'OAUTH2' | 'API_KEY_HMAC' | 'STATIC_TOKEN' | 'NONE';
  readonly scope: 'PLATFORM' | 'TENANT'; // ver seção 4
  getValidAccessToken(tenantId?: string): Promise<string>;
}
```

### 3.4 — Validação de payload por tipo de regra

Cada `ruleType` tem um schema de validação próprio, aplicado antes de qualquer persistência — é isso que garante que o JSONB flexível da seção 2.2 nunca vira "lixo estruturado":

```typescript
export interface RulePayloadValidator<T> {
  readonly ruleType: 'FEE_RULE' | 'SHIPPING_POLICY' | 'CATEGORY_TAXONOMY';
  validate(raw: unknown): T; // lança erro descritivo se o formato não bater
}

// Exemplo de shape esperado para FEE_RULE — implementado com class-validator
// ou Zod, a decidir na implementação.
export interface FeeRulePayload {
  commissionPct?: number;
  fixedFeeAmount?: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
}
```

### 3.5 — Porta consumida pelo Pricing Engine (a única coisa que o motor de preço conhece)

```typescript
export interface ResolvedFeeRule {
  commissionPct: number;
  fixedFeeAmount: number;
  ruleId: string;      // para auditoria: qual MarketplaceRule.id gerou este resultado
  ruleVersion: number;
}

export interface FeeRuleResolver {
  resolveFeeRule(params: {
    marketplaceCode: string;
    categoryCode: string;
    tenantId: string;
    atDate?: Date; // default: agora — permite reconstruir "qual era a regra em tal data"
  }): Promise<ResolvedFeeRule>;
}
```

O Pricing Engine (próxima etapa, depois desta) importa só esta interface. Não importa `MarketplaceProvider`, não importa Prisma model nenhum deste módulo, não sabe que `RuleSyncOrchestrator` existe.

---

## 4. Autenticação por marketplace

Cada marketplace tem um mecanismo diferente — é exatamente por isso que `AuthStrategy` precisa ser uma interface, não uma implementação única:

| Marketplace | Mecanismo | Escopo típico |
|---|---|---|
| Mercado Livre | OAuth2 (authorization code + refresh token) | Dados públicos de comissão não exigem token de vendedor; dados específicos de conta exigem OAuth por tenant |
| Amazon (SP-API) | OAuth2 (Login with Amazon) + assinatura de requisição AWS SigV4 | Autorização por tenant (cada vendedor autoriza o app) |
| Shopee | `partner_id` + `partner_key` com assinatura HMAC, mais token de loja | App-level (partner) + token por loja (tenant) |
| TikTok Shop | `app_key`/`app_secret` + token de loja | App-level + token por loja (tenant) |
| Magalu | OAuth2 (conforme portal de desenvolvedores) | Por tenant |
| SHEIN | Open Platform — mecanismo específico não confirmado por documentação pública acessível na pesquisa anterior | A confirmar quando esse adaptador for construído |

Distinção importante que fica explícita na interface (`authScope: 'PLATFORM' | 'TENANT'`): informação de regra de marketplace (comissão, política de frete) normalmente é **pública ou de nível de aplicativo** — não exige autorização de cada vendedor. Autorização por tenant só entra quando o dado depende da conta específica (ex.: tier de reputação do vendedor, ou, na etapa futura de repricing, a permissão para de fato alterar o preço do anúncio). O `marketplace-intelligence` majoritariamente usa auth `PLATFORM`; auth `TENANT` é reaproveitado pelo futuro módulo de integração de canal (push de preço), que ainda não existe.

Armazenamento de credenciais reaproveita a entidade `IntegrationCredential` já prevista no PRD original (seção 8), criptografada em repouso, com um campo `authScope` adicional.

---

## 5. Pipeline de sincronização

### 5.1 — Gatilhos

- **Agendado**: `ProviderSyncSchedule` define intervalo por provider+capability. Um job leve roda a cada poucos minutos, verifica quais schedules estão vencidos (`lastRunAt + intervalMinutes < now`) e enfileira a sincronização correspondente — evita a complexidade de registrar jobs recorrentes dinâmicos no BullMQ; mudar a frequência é um `UPDATE` na tabela, não um redeploy.
- **Sob demanda**: botão "verificar agora" no painel, dispara o mesmo pipeline manualmente.

### 5.2 — Passos do pipeline (`RuleSyncOrchestrator`)

1. **Fetch** — chama o método correspondente do provider (`fetchFeeRules`, etc.), respeitando timeout.
2. **Normalize** — cada candidato bruto passa pelo `RulePayloadValidator` do `ruleType` correspondente; se um item individual falha validação, ele é descartado e logado — o lote inteiro não falha por causa de um item malformado (resiliência parcial, seção 9).
3. **Hash & Diff** — calcula `contentHash` do payload normalizado e compara com o hash da última `MarketplaceRule` com `status = VALIDADA` para aquele `(marketplace, ruleType, scopeKey, tenantId)`. Hash igual = nenhuma mudança real, só atualiza `lastRunAt` do schedule e encerra (evita poluir o histórico com sincronizações que não mudaram nada).
4. **Decide** — hash diferente: cria uma nova `MarketplaceRule` com `version + 1`. Status inicial depende de `ProviderSyncSchedule.autoTrust`: se `true`, nasce `VALIDADA` direto; se `false` (configuração inicial recomendada e já confirmada para a primeira fase), nasce `PENDENTE_VALIDACAO`.
5. **Persist** — grava a nova versão e um `MarketplaceChangeEvent` correspondente, com `changeSummary` gerado automaticamente (diff estrutural simples entre o payload antigo e o novo, formatado em texto: "comissão de 14% para 16%", por exemplo).
6. **Emit** — dispara um evento de domínio (seção 11).

### 5.3 — Geração do resumo de mudança

`changeSummary` é gerado por um diff estrutural raso entre os dois payloads JSON (chave por chave), formatado como texto. Não é IA nesta fase — é comparação determinística. Fica registrado como possível evolução futura (resumo em linguagem natural via LLM) mas o MVP não depende disso para funcionar.

---

## 6. Prioridade de fonte vs. override manual

Dois mecanismos independentes, para não repetir o erro de tratar "prioridade" como resposta única para dois problemas diferentes:

- **Prioridade de preenchimento de lacuna**: quando não existe nenhuma `MarketplaceRule VALIDADA` ainda para um `scopeKey`, a ordem de confiança para *criar* a primeira versão é API oficial → documentação oficial → importação → manual. Implementada como configuração (`ProviderPriorityPolicy`), não código hardcoded — o time de operação pode reordenar por marketplace se um provider específico se mostrar não confiável.
- **Pin manual**: um administrador pode marcar `pinned = true` em qualquer `MarketplaceRule`, de qualquer fonte. Enquanto uma regra está pinada, o pipeline de sync continua rodando e continua **detectando** diferenças (gera `MarketplaceChangeEvent` normalmente), mas nunca promove automaticamente uma nova versão por cima da pinada — sempre fica `PENDENTE_REVIEW`, esperando o humano decidir se quer desafixar. Isso preserva a autoridade final do operador sem cegar o sistema para o que a fonte automática está reportando.

---

## 7. Cache

O `FeeRuleResolver` é chamado em altíssima frequência pelo Pricing Engine (potencialmente a cada cálculo de preço de cada SKU × marketplace). Estratégia: **cache-aside no Redis**, chave `feerule:{marketplaceCode}:{categoryCode}:{tenantId}:{dateBucket}`, TTL longo (regras mudam raramente) combinado com **invalidação ativa por evento**: quando uma `MarketplaceRule` é promovida a `VALIDADA`, o mesmo evento de domínio que dispara alerta (seção 11) também dispara a invalidação da chave de cache correspondente. Isso evita os dois problemas comuns de cache de regra de negócio: TTL curto demais (bate no banco toda hora à toa) ou TTL longo demais (serve dado errado depois de uma correção).

---

## 8. Scheduler

BullMQ, fila `marketplace-intelligence-sync`, um job "orquestrador" leve rodando a cada poucos minutos que consulta `ProviderSyncSchedule` e enfileira um job de sincronização por schedule vencido. Cada job de sincronização carrega `correlationId` próprio, usado para agrupar todas as entradas de `ProviderSyncLog` daquela execução — essencial para depurar "o que aconteceu na sincronização das 3h" sem precisar cruzar timestamps manualmente.

---

## 9. Tratamento de falhas

- **Retry com backoff exponencial** por chamada de provider (3 tentativas, 2s/8s/32s) para falhas transitórias de rede.
- **Circuit breaker por provider**: N falhas consecutivas → `ProviderHealth.status = DOWN`, pausa novas tentativas por um período de cooldown, dispara alerta ("Mercado Livre API fora do ar há X horas"). Evita martelar uma API que já está caída e evita estourar rate limit tentando repetidamente.
- **Resiliência parcial**: falha de normalização/validação de um candidato individual não derruba o lote inteiro — grava o que é válido, loga o que não é.
- **Correlação de freshness com `DESATUALIZADA`**: um job de auditoria de frescor roda periodicamente e marca `MarketplaceRule.status = DESATUALIZADA` quando uma regra `VALIDADA` não foi reconfirmada dentro do SLA esperado daquele provider — sinal de "não sei mais se isso ainda é verdade", distinto de `OBSOLETA` (que significa "sei que isso foi substituído").

---

## 10. Auditoria e histórico

Já coberto na seção 2.3–2.4: `MarketplaceRule` é o registro de conteúdo (append-only, nunca editado, só superado por nova versão), `MarketplaceChangeEvent` é o registro de produto que alimenta o painel, `ProviderSyncLog`/`ProviderHealth` é o registro operacional. Quando o Pricing Engine existir (próxima etapa), cada cálculo de preço grava o `ruleId` e `ruleVersion` usados — assim é possível reconstruir exatamente qual regra estava vigente em qualquer data passada.

---

## 11. Eventos de domínio

Nesta fase (monólito), uso `@nestjs/event-emitter` (in-process, sem infraestrutura extra) — o ponto importante não é o transporte, é que o módulo **emite e não sabe quem escuta**. Se um dia o módulo for extraído como serviço, o evento in-process vira evento em fila (BullMQ/RabbitMQ) sem mudar quem emite.

Eventos emitidos:

- `MarketplaceRuleCandidateDetected` — uma diferença foi encontrada (antes de decidir status).
- `MarketplaceRuleValidated` — uma versão foi promovida a `VALIDADA`. Assinantes: invalidação de cache (seção 7); no futuro, gatilho de recálculo de preço para os produtos afetados por aquela categoria/marketplace.
- `MarketplaceRulePendingReview` — assinante: módulo de Alertas (cria notificação para o admin).
- `ProviderHealthChanged` — assinante: Alertas + Dashboard.

---

## 12. Receita para adicionar um novo marketplace

1. `INSERT` em `Marketplace` (code, displayName) — sem migration.
2. Implementar `XyzApiProvider` implementando as interfaces de capacidade cabíveis (`FeeRuleCapableProvider`, `AuthenticatedProvider`, etc.) — um arquivo novo, isolado.
3. Implementar `XyzAuthStrategy implements AuthStrategy`, se aplicável.
4. Registrar o provider em `providers.registry.ts` — o único arquivo de composição que cresce, e é literalmente uma lista, não lógica de negócio.
5. `INSERT` em `ProviderSyncSchedule`.

Nenhuma linha muda em `RuleSyncOrchestrator`, `RuleRegistryService`, `FeeRuleResolver` ou no futuro Pricing Engine. **Honestidade técnica**: isso vale para lógica de domínio. Telas de admin que listam marketplaces por nome, ou relatórios que agrupam por canal, continuam funcionando sem mudança porque leem de `Marketplace` como dado — mas isso é diferente de dizer que literalmente nenhum arquivo do sistema inteiro muda; é a lógica de regras/precificação que fica imune, que é o objetivo real por trás do seu pedido.

---

## 13. O que fica para a próxima etapa

Este documento define contratos e modelo de dados. A implementação (Etapa 3) entrega: schema Prisma completo deste módulo, `MarketplaceProviderRegistry`, `RuleSyncOrchestrator`, `RuleRegistryService` (com cache), endpoints de administração (revisar pendências, pin/unpin, importar CSV, cadastro manual), o único adaptador funcional (`MercadoLivreApiProvider` + `MercadoLivreAuthStrategy`), e o job do scheduler. `FeeRuleResolver` fica pronto para ser consumido quando o Pricing Engine for construído na etapa seguinte a essa.

## 14. Lado de escrita — repricing (adicionado depois da implementação inicial)

Tudo acima (seções 1–13) descreve o lado de LEITURA: capturar regra de taxa, versionar, aprovar. Numa etapa posterior, o pedido explícito foi "o Pricing Engine manda um comando de atualizar preço sem saber o canal" — isso exigiu estender a arquitetura de providers com um lado de escrita, seguindo o mesmo princípio de Interface Segregation da seção 3:

- **`ListingCapableProvider`** (`listActiveListings`) e **`PriceUpdateCapableProvider`** (`updatePrice`) — duas interfaces novas em `marketplace-provider.contract.ts`, com duas capacidades novas no enum `ProviderCapability` (`LISTINGS`, `PRICE_UPDATE`). Um provider implementa só as capacidades que sabe entregar — `MercadoLivreFeeRuleProvider` hoje implementa as três (`FeeRuleCapableProvider` + as duas novas), mas nada obriga isso.
- **`PriceUpdateDispatcher`** (`shared/contracts/price-update-dispatcher.port.ts`) — a porta que o Pricing Engine de fato vai consumir. `dispatch(command)` acha o provider certo via `MarketplaceProviderRegistry.findPriceUpdateProvider(marketplaceCode)` e chama `updatePrice`. Canal sem provider de escrita não é exceção — é um resultado de negócio (`{ success: false, message }`), porque um repricing automático rodando em lote não pode depender de try/catch por canal.
- **Honestidade técnica, igual à API pública do Mercado Livre na primeira entrega:** `listActiveListings`/`updatePrice` do `MercadoLivreFeeRuleProvider` são estrutura, não chamada real — lançam `NotImplementedException` porque a API do Mercado Livre exige OAuth2 por vendedor para essas duas operações (não são endpoints públicos como `categories`/`listing_prices`). O `AuthStrategy`/`AuthenticatedProvider` que já existiam no contrato desde a seção 4, sem uso até aqui, finalmente têm um consumidor real: `ensureValidCredentials` é o único método que muda quando o OAuth2 for implementado de verdade.

## 15. Teste de integração do `PriceUpdateDispatcher` — a "garantia de qualidade" para novos providers

Antes de avançar para qualquer módulo novo (ex.: Competition Intelligence), o Dispatcher precisa provar que é à prova de falhas: nenhum canal — registrado, não registrado, sem suporte a escrita, ou com erro de infraestrutura — pode derrubar um repricing em lote com uma exceção não tratada.

**Nota técnica honesta:** ao preparar este teste, foi encontrado um gap real no projeto — `apps/api/package.json` não tinha nenhum bloco `"jest"` configurado (nem `jest.config.js` em lugar nenhum do repo), apesar de `ts-jest`/`@nestjs/testing` já estarem instalados. Sem esse bloco, o Jest não sabe transformar `.ts` com decorators do NestJS, e nenhum teste baseado em `Test.createTestingModule` conseguiria rodar. Isso foi corrigido como parte desta etapa (bloco `jest` padrão do NestJS, com `transform` via `ts-jest`).

**Onde está o teste:** `apps/api/src/modules/marketplace-intelligence/application/price-update-dispatcher.integration.spec.ts`.

É um teste de **integração**, não unitário: usa `Test.createTestingModule` do `@nestjs/testing` para montar o DI real entre `MarketplaceProviderRegistry` e `PriceUpdateDispatcherService` — as duas classes de produção, coladas uma na outra. Só o provider concreto (a borda externa do sistema) é substituído por um dublê (`MockPriceUpdateProvider` / `MockReadOnlyProvider`), injetado via `MARKETPLACE_PROVIDERS`, exatamente como um provider real seria registrado no module.

Cobre 4 cenários:

1. **Sucesso** — provider registrado com capacidade `PRICE_UPDATE` para o `marketplaceCode` pedido: `dispatch()` chama `updatePrice()` com os parâmetros certos e propaga o resultado.
2. **Proteção — canal não registrado**: nenhum provider bate com o `marketplaceCode` → `{ success: false, message }`, sem exceção.
3. **Proteção — canal registrado mas sem capacidade de escrita**: provider existe, mas não implementa `PriceUpdateCapableProvider` → mesmo resultado protegido do cenário 2.
4. **Proteção — falha de infraestrutura do provider**: `updatePrice()` do provider rejeita (simulando timeout/erro de API externa) → o `try/catch` do Dispatcher converte isso em `{ success: false, message }`, nunca deixa a exceção subir.

**Como rodar (e como todo novo provider deve se autovalidar):**

```bash
cd apps/api
npm test -- price-update-dispatcher
```

Isso roda só este arquivo (o nome bate com `.spec.ts` do `testRegex`). Para rodar a suíte inteira: `npm test`. Qualquer implementação nova de provider (`ListingCapableProvider`/`PriceUpdateCapableProvider`) não precisa de teste próprio para o Dispatcher — só precisa continuar passando este teste sem alteração, já que ele testa o contrato, não uma API de canal específica.

## 16. Arquitetura de Adaptadores Multicanal — reaproveitamento, não reconstrução

**Correção de premissa, para registro:** o pedido pediu para "projetar" uma estrutura de Connectors com uma interface `IMarketplaceConnector` padrão e isolamento de falha. Essa estrutura **já existe**, desde a Etapa 4 (seção 3-4 deste documento) e foi estendida na Etapa 8 (seção 14). Nada abaixo é código novo — é o mapeamento explícito entre o que foi pedido e o que já está implementado, porque os nomes usados no pedido (`Connector`, `IMarketplaceConnector`) são diferentes dos nomes já em uso no código (`MarketplaceProvider`).

**1. Estrutura de Connectors → `MarketplaceProvider` + `MarketplaceProviderRegistry`.** Todo adaptador (Nuvemshop, e os futuros ML/Shopee/TikTok/Amazon/Magalu/SHEIN) implementa `MarketplaceProvider` (`code`, `marketplaceCode`, `sourceType`, `capabilities`, `healthCheck()`) e se registra no token multi-provider `MARKETPLACE_PROVIDERS` (seção 12 acima, "Receita para adicionar um novo marketplace") — nenhuma classe de orquestração (`RuleSyncOrchestrator`, `PriceUpdateDispatcherService`, o futuro Pricing Engine) precisa saber quantos ou quais adaptadores existem.

**2. `IMarketplaceConnector` → `MarketplaceProvider` + interfaces de capacidade (Interface Segregation).** Em vez de uma interface única "faz tudo" (o que forçaria cada adaptador a implementar métodos que não faz sentido para aquele canal), o contrato é segregado por capacidade — `FeeRuleCapableProvider.fetchFeeRules()` é especificamente a "leitura padronizada de taxas/comissão" pedida: qualquer adaptador que implemente essa interface entrega `RawRuleCandidate[]` no mesmo formato, não importa se por trás é scraping, API oficial ou arquivo importado. `ListingCapableProvider`/`PriceUpdateCapableProvider` (seção 14) cobrem o lado de escrita (repricing). Um adaptador implementa só as capacidades que sabe entregar — `type guards` (`isFeeRuleCapable`, `isPriceUpdateCapable`) protegem contra chamar um método que o adaptador não suporta.

**3. Isolamento de falha → já implementado em três camadas independentes**, nenhuma nova:
   - **Por provider, dentro do sync:** `RuleSyncOrchestrator.runSyncPass` (seção 5) envolve a chamada ao provider em `try/catch` com retry+backoff (`withRetry`, 3 tentativas, 2s/8s/32s) — se um provider falhar (timeout, API fora do ar), só aquele provider registra falha; os demais continuam a própria sincronização normalmente, porque o loop é por provider, não uma chamada única para todos.
   - **Saúde monitorada, não silenciosa:** toda falha chama `ProviderHealthRepository.recordFailure` (contador de falhas consecutivas + mensagem), toda sucesso chama `recordSuccess` — um canal instável fica visível (`ProviderHealthChanged`, seção 11), sem precisar derrubar nada para ser percebido.
   - **No lado de escrita, resultado de negócio, não exceção:** `PriceUpdateDispatcherService.dispatch()` (seção 14) nunca deixa uma exceção de provider subir — canal não registrado, sem capacidade de escrita, ou erro de infraestrutura viram `{ success: false, message }`. Um repricing em lote (futuro Pricing Engine chamando `dispatch` centenas de vezes) nunca é interrompido por um canal com problema.

**4. Armazenamento de credenciais → `CredentialEncryptionService` (`shared/security/`), já genérico.** AES-256-GCM, chave derivada de `ERP_CREDENTIALS_ENCRYPTION_KEY` (env var — documentado no README que precisa de um valor forte em produção, nunca commitado). Hoje usado por `OlistConnection.apiTokenEnc` e `NuvemshopConnection.accessTokenEnc`; qualquer adaptador novo que precise guardar uma credencial (token OAuth2, API key) reusa o mesmo serviço — é infraestrutura compartilhada, não algo por canal. Isolamento adicional, por construção: uma credencial mal configurada ou expirada de um canal nunca impede os outros de funcionar, porque cada `AuthenticatedProvider.ensureValidCredentials(tenantId)` é chamado e tratado independentemente, dentro do mesmo `try/catch` por provider descrito no item 3.

**5. Status real dos 6 canais citados no pedido** — para não sugerir que todos já têm um adaptador funcional:

| Canal | Status | O que existe |
|---|---|---|
| Nuvemshop | Funcional (leitura + escrita) | `NuvemshopFeeRuleProvider` (Etapa 7) + conexão/credencial + sync de `ChannelListing`; `PriceUpdateDispatcher` aplica preço de verdade via app privado |
| Mercado Livre | Parcial | `MercadoLivreFeeRuleProvider` lê taxas de verdade (API pública); `listActiveListings`/`updatePrice` são stubs (`NotImplementedException`) — a API de escrita exige OAuth2 por vendedor, não implementado ainda (seção 14) |
| Shopee | Backlog | Nenhum adaptador — entra seguindo a receita da seção 12 quando houver credencial/acesso à API para implementar de verdade |
| TikTok Shop | Backlog | Idem |
| Amazon | Backlog | Idem |
| Magalu | Backlog | Idem |
| SHEIN | Backlog | Idem |

**Honestidade técnica:** não foram criados 5 adaptadores-stub para Shopee/TikTok/Amazon/Magalu/SHEIN neste momento. Um adaptador que só lança `NotImplementedException` em tudo não prova nada que o teste de integração da seção 15 já não prove (o contrato aguenta um provider "vazio" sem quebrar o Dispatcher) — e escrever um adaptador com dados de API inventados, sem documentação oficial real consultada, seria fabricar uma integração que pareceria funcionar sem funcionar. Quando você tiver acesso a credenciais/documentação de qualquer um desses canais, a implementação é: 1 arquivo novo (o adaptador) + 1 linha no registry (seção 12) — a arquitetura já está pronta para isso hoje, sem esperar nenhuma mudança estrutural adicional.
