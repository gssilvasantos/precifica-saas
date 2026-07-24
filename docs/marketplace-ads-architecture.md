# Módulo de Ads Multicanal — Arquitetura

**Status:** Fase 1 (dashboard de leitura), Fase 2 (alertas inteligentes) e Fase 3 (automação de escrita com Safety Lock) concluídas para Mercado Livre — sync automático a cada 2h já avaliando alertas e criando sugestões de ação; nenhuma ação de escrita é aplicada sem confirmação explícita de um usuário ADMIN. Shopee/TikTok/Amazon/Magalu ainda não têm acesso de API concedido (ver `docs/marketplace-ads-api-access-plan.md`) — a base está pronta para recebê-los sem retrabalho.

## 1. Por que um bounded context próprio

Ads é um fato do canal, assim como pedido ou taxa: cada marketplace expõe campanhas/métricas com vocabulário e granularidade próprios. Mesmo racional dos módulos anteriores — schema Prisma próprio (`marketplace_ads`), acoplado ao resto só via portas e capacidades de provider, nunca lendo tabela de outro módulo diretamente.

Decisão de escopo (autorizada explicitamente pelo usuário): implementação real desta fase cobre **só Mercado Livre**, mas toda a arquitetura — registro de providers, orquestrador de sync, serviço de insights — é multicanal desde o primeiro dia. Adicionar Shopee/TikTok/Amazon/Magalu depois é registrar mais um `AdsCapableProvider`, nunca alterar `AdsProviderRegistry`/`AdsSyncOrchestrator`/`AdsInsightsService`.

## 2. Contrato de dados — payload normalizado

Todo canal devolve campanhas e métricas já traduzidas para este formato (`shared/contracts/marketplace-provider.contract.ts`) — o adapter é o ÚNICO lugar que conhece o formato bruto do canal:

```ts
interface RawAdsCampaignCandidate {
  externalCampaignId: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'UNKNOWN'; // já traduzido pelo adapter
  dailyBudget: number | null;
}

interface RawAdsMetricCandidate {
  externalCampaignId: string;
  periodDate: Date;   // granularidade diária
  spend: number;
  revenueAds: number; // vendas atribuídas ao anúncio pelo próprio marketplace
  clicks: number;
  impressions: number;
}

interface AdsCapableProvider extends MarketplaceProvider {
  fetchAdsCampaigns(ctx: FetchContext): Promise<RawAdsCampaignCandidate[]>;
  fetchAdsMetrics(ctx: FetchContext, dateFrom: Date, dateTo: Date): Promise<RawAdsMetricCandidate[]>;
}
```

Granularidade de **campanha** (não ad-group/anúncio individual) no MVP — suficiente para a pergunta que o dashboard responde ("essa campanha está dando lucro?"). Persistido como `AdsCampaign` + `AdsMetricSnapshot[]` (schema `marketplace_ads`). Chave natural: `@@unique([tenantId, channelCode, externalCampaignId])` para campanha, `@@unique([campaignId, periodDate])` para snapshot diário — mesmo padrão de idempotência usado em `Order`/`OrderItem`.

Deliberadamente **sem** um campo de "receita orgânica" no contrato: nenhuma API de Ads de marketplace devolve isso (é uma métrica derivada, não um fato do canal). TACOS é calculado no application layer combinando `spend` daqui com a receita total do tenant.

## 3. Métricas de domínio (função pura, `domain/ads-metrics.ts`)

```ts
calculateRoas(totals): number | null        // revenueAds / spend — null quando spend <= 0
calculateTacos(adsSpend, totalRevenue): number | null  // adsSpend / totalRevenue — null quando revenue <= 0
classifyCampaignHealth(totals, thresholds): { tier, recommendation }
```

4 tiers de saúde de campanha (refinado a partir de uma matriz BCG de 3 tiers proposta inicialmente — adicionado o 4º estado por honestidade: dado insuficiente não é "custo perdido"):

| Tier | Condição | Significado |
|---|---|---|
| `SEM_DADOS` | clicks < `minClicksForSignal` (padrão 30) | Amostra pequena demais para julgar — evita alarme falso em campanha nova |
| `ESTRELA` | ROAS ≥ `roasHealthy` (padrão 3) | Retorno saudável, considerar aumentar orçamento |
| `PONTO_DE_ATENCAO` | ROAS entre 1 e `roasHealthy` | Está pagando o próprio custo mas sem folga — monitorar |
| `CUSTO_PERDIDO` | ROAS < 1 | Gastando mais do que a venda atribuída retorna |

Limiares são parâmetros (`CampaignHealthThresholds`), não constantes hardcoded — futuro: configurável por tenant, mesmo padrão de `FinancialPolicy` (piso de margem).

## 4. TACOS reaproveita a MESMA porta do DRE

Regra de ouro do projeto: nunca duplicar uma fonte de fato. `AdsInsightsService` combina `ADS_CAMPAIGN_REPOSITORY.sumMetricsByCampaign` (spend total) com `ORDER_FINANCIALS_READER.listForPeriod` (receita total do tenant no período) — a MESMA porta que já alimenta `FinancialOrchestrator`/DRE (`docs/financial-intelligence-architecture.md`). Nenhuma segunda fonte de "quanto foi vendido" foi inventada.

```
AdsInsightsService.getDashboard(tenantId, dateFrom, dateTo)
  │
  ├─ ADS_CAMPAIGN_REPOSITORY.listCampaigns(tenantId)
  ├─ ADS_CAMPAIGN_REPOSITORY.sumMetricsByCampaign(tenantId, dateFrom, dateTo)  → totals por campanha + spend agregado
  └─ ORDER_FINANCIALS_READER.listForPeriod(tenantId, dateFrom, dateTo)        → totalTenantRevenue (soma de totalAmount)
        │
        ▼
  AdsDashboard { campaigns[] (cada uma com roas/tier/recommendation), totals, totalTenantRevenue, tacos }
```

## 5. Adaptador Mercado Livre

`MercadoLivreAdsProvider` mora dentro de `marketplace-intelligence` (mesmo módulo de `MercadoLivreOrderProvider`/`MercadoLivreFeeRuleProvider`), não em `marketplace-ads` — decisão deliberada para reaproveitar `MercadoLivreConnectionService` (OAuth2) sem precisar exportá-lo por um token novo em `shared/contracts` (essa classe não é exportada do módulo hoje; só as classes concretas de provider são). Registrado em `ADS_CAPABLE_PROVIDERS` via `useFactory` em `marketplace-ads.module.ts`, mesmo padrão de `MARKETPLACE_PROVIDERS`/`ORDER_CAPABLE_PROVIDERS`.

**Reuso de credencial:** nenhuma reautorização do vendedor é necessária — o mesmo `getValidAccessToken(tenantId)` usado por pedidos/taxas serve para Ads; a única mudança necessária é habilitar o escopo `advertising/product_ads` no app cadastrado no painel do Mercado Livre.

**Aviso de honestidade (documentado em código, `mercado-livre-api.client.ts`):** os 3 endpoints de Ads (`fetchAdvertiserId`, `fetchAdsCampaigns`, `fetchAdsCampaignMetrics`) foram montados a partir de fontes secundárias — a documentação oficial (`developers.mercadolivre.com.br/product-ads-us-read`) é renderizada via JS e não pôde ser lida por completo neste ambiente de desenvolvimento. Os paths/headers/shape de resposta seguem o mesmo padrão já confirmado nos endpoints públicos (`results[]`/`paging{offset,limit,total}`), mas **não foram validados contra uma chamada real**. Isso só será possível depois que o escopo for aprovado e testado a partir de uma máquina com rede real (mesma limitação já documentada para o R2, `docs/deploy-render-supabase-r2.md` §3.5). Até lá, qualquer resposta com formato inesperado estoura erro explícito (`pickString`/`pickNumber` com múltiplas chaves candidatas, nunca default silencioso) — mesma disciplina do `RulePayloadValidator`.

Janela de métricas limitada a `MAX_METRICS_WINDOW_DAYS = 90` (limite documentado publicamente da API do ML) — o provider valida e lança erro explícito se o orquestrador pedir janela maior, nunca trunca silenciosamente.

## 6. Sincronização

`AdsSyncOrchestrator` espelha `OrderSyncOrchestrator`: por tenant (via `listTenantIdsToSync()` do provider) → busca campanhas → upsert por campanha (try/catch item, alerta WARNING, batch continua) → busca métricas dos últimos `METRICS_SYNC_WINDOW_DAYS = 30` dias → upsert por snapshot diário → falha de batch inteiro dispara alerta ERROR + `ProviderHealthRepository.recordFailure` + `ProviderSyncLogRepository.finish({status:'FAILED'})`. Métrica órfã (campanha não encontrada neste ciclo) é pulada com warning, nunca falha o batch inteiro.

`AdsSyncSchedulerJob`: `@Cron(CronExpression.EVERY_2_HOURS)` — mesma cadência de granularidade diária de métrica, sem necessidade de polling mais frequente.

## 7. Alertas inteligentes (Fase 2)

`AdsAlertingService` avalia, para cada campanha, a MESMA `classifyCampaignHealth` que já alimenta o dashboard — nenhuma segunda regra de negócio inventada. Só `CUSTO_PERDIDO` é alert-worthy (é o único tier com recomendação acionável de "considere pausar"); `ESTRELA`/`PONTO_DE_ATENCAO` são informativos, `SEM_DADOS` nunca alerta (campanha nova, não é um problema).

**Máquina de estado (evita spam e evita silêncio permanente):** `AdsCampaign.lastAlertedTier` (novo campo, Fase 2) guarda o último tier que gerou alerta. `determineAlertAction(previousAlertedTier, currentTier)` (função pura, `domain/ads-metrics.ts`) decide:

| Situação | Ação |
|---|---|
| Currently `CUSTO_PERDIDO`, ainda não alertada | `ALERT` — emite alerta, grava `lastAlertedTier = CUSTO_PERDIDO` |
| Continua `CUSTO_PERDIDO`, já alertada | `NONE` — não repete a cada sync de 2h |
| Recuperou de `CUSTO_PERDIDO` para qualquer outro tier | `RESET` — limpa `lastAlertedTier` para `null`, permitindo alertar de novo se piorar no futuro |
| Nunca foi `CUSTO_PERDIDO` | `NONE` |

Chamado por `AdsSyncOrchestrator.syncTenant()`, DEPOIS que campanhas e métricas da janela inteira já foram persistidas (nunca durante o loop de upsert — os totais estariam incompletos). Try/catch próprio, separado do try/catch que decide `SUCCESS`/`FAILED` do sync: uma falha ao avaliar alertas nunca reverte um sync que já persistiu dado bom.

Reaproveita o MESMO `ALERT_SERVICE` (`shared/observability`) já usado pelas falhas técnicas de sync — não existe (ainda) um canal de "alerta de negócio" separado; `source: 'AdsAlertingService'` e `severity: 'WARNING'` já diferenciam isto de uma falha técnica, e a mesma porta permite trocar console por Slack/e-mail no futuro sem tocar em quem emite.

Deliberadamente desacoplado de `OrdersModule`/TACOS: a saúde de uma campanha é uma propriedade DELA (spend/revenueAds/clicks), calculada só com `ADS_CAMPAIGN_REPOSITORY` — ao contrário de `AdsInsightsService`, `AdsAlertingService` não precisa de `ORDER_FINANCIALS_READER`.

## 8. Endpoints

- `GET /marketplace-ads/dashboard?dateFrom&dateTo` — janela padrão 30 dias, `JwtAuthGuard`+`RolesGuard`.
- `POST /marketplace-ads/providers/:providerCode/sync` — sync manual sob demanda, `@Roles(ADMIN)`.

Não há endpoint de leitura de alertas ainda — hoje eles só saem pelo `ALERT_SERVICE` (console/log estruturado), mesma visibilidade que qualquer alerta técnico de sync. Um endpoint `GET /marketplace-ads/alerts` (listando campanhas com `lastAlertedTier` preenchido) é um incremento futuro natural para o frontend, não implementado nesta fatia.

## 9. Automação de escrita — Safety Lock (Fase 3)

Primeira ação de escrita do módulo (`pauseCampaign`) contra um marketplace real — e a única garantia de negócio que importa aqui é que **nenhuma chamada de escrita acontece sem confirmação explícita de um usuário ADMIN**. Nada de "auto-pilot": o sistema sugere, o humano decide.

**Capacidade de escrita — interface irmã, não subtipo.** `AdsActionCapableProvider` (novo, `shared/contracts/marketplace-provider.contract.ts`) estende `MarketplaceProvider` diretamente, no mesmo nível de `AdsCapableProvider` — não uma estende a outra. Mesmo racional de `PriceUpdateCapableProvider` no Pricing Intelligence: ler e escrever são capacidades independentes, um provider pode ter uma sem a outra.

```ts
interface AdsActionResult { success: boolean; message?: string; }
interface AdsActionCapableProvider extends MarketplaceProvider {
  pauseCampaign(ctx: FetchContext, externalCampaignId: string): Promise<AdsActionResult>;
}
```

`MercadoLivreAdsProvider` implementa as duas interfaces (`ProviderCapability.ADS` e `ProviderCapability.ADS_ACTIONS`). `pauseCampaign` chama `PUT .../product_ads/campaigns/:id` com `{status: 'paused'}` — mesmo aviso de honestidade da Fase 1 (path/shape não validados contra chamada real, ver seção 5).

**A fila de aprovação — `AdsActionSuggestion` (schema `marketplace_ads`).** Máquina de estado com 5 status: `PENDING → CONFIRMED → APPLIED` (feliz) ou `PENDING → CONFIRMED → FAILED` (provider falhou) ou `PENDING → REJECTED` (usuário disse não). Nunca pula PENDING.

| Quem | O que faz | Nunca faz |
|---|---|---|
| `AdsAlertingService` (Fase 2, roda no cron de sync) | Cria a sugestão como `PENDING` quando `shouldSuggestPauseAction(tier)` é true — MESMA condição de `determineAlertAction === 'ALERT'`, mesmo evento, nunca uma segunda regra paralela | Aplica a ação. Nunca chama `pauseCampaign`. |
| `AdsActionDispatcherService` (só reage a HTTP) | `confirmAndApply`: marca `CONFIRMED`, resolve o provider certo via `AdsProviderRegistry.findByMarketplaceCode` + `isAdsActionCapable`, chama `pauseCampaign`, marca `APPLIED`/`FAILED`. `reject`: marca `REJECTED`, nunca toca o provider. | Decide sozinho. Só age em resposta a uma chamada explícita do controller. |

Idempotência: `findOpenSuggestion(tenantId, campaignId, actionType)` impede empilhar uma segunda sugestão `PENDING`/`CONFIRMED` para a mesma campanha+tipo de ação enquanto a decisão anterior ainda está em aberto — evita a mesma campanha ruim gerar 12 sugestões idênticas em 24h de sync a cada 2h.

Falha ao aplicar (provider não encontrado para o canal, ou `pauseCampaign` devolve `{success:false}`) nunca lança exceção para o controller — marca `FAILED` com `failureReason` e emite alerta `severity: 'ERROR'` no MESMO `ALERT_SERVICE` já usado pelo resto do módulo (`source: 'AdsActionDispatcherService'`). O usuário vê a falha tanto na resposta HTTP quanto no canal de alertas.

**Endpoints** (`AdsActionsController`, `marketplace-ads/actions`, `JwtAuthGuard`+`RolesGuard`):

- `GET /marketplace-ads/actions/pending` — qualquer usuário autenticado do tenant.
- `POST /marketplace-ads/actions/:id/confirm` — `@Roles(ADMIN)`, único caminho que efetivamente aplica a ação.
- `POST /marketplace-ads/actions/:id/reject` — `@Roles(ADMIN)`.

`@CurrentUser()` fornece `userId` para `confirmedByUserId`/`rejectedByUserId` — toda decisão fica auditável (quem, quando).

## 10. Extensibilidade — adicionar um canal novo (leitura + escrita)

1. Implementar `AdsCapableProvider` (leitura, 2 métodos) no módulo dono da conexão do canal — reaproveitar OAuth2/credencial já existente, nunca duplicar.
2. Opcionalmente, implementar também `AdsActionCapableProvider` (escrita, `pauseCampaign`) na MESMA classe — as duas interfaces são independentes, um canal pode ter só leitura por enquanto.
3. Exportar a classe do módulo dono.
4. Adicionar ao array `useFactory` de `ADS_CAPABLE_PROVIDERS` em `marketplace-ads.module.ts`.
5. Nenhuma mudança em `AdsProviderRegistry`/`AdsSyncOrchestrator`/`AdsInsightsService`/`AdsAlertingService`/`AdsActionDispatcherService`/domain/schema/endpoints — alertas E sugestões de ação passam a funcionar automaticamente para o canal novo (a máquina de estado é genérica, por campanha); `AdsActionDispatcherService` simplesmente não encontra um provider `ADS_ACTIONS`-capable para canais que só implementaram leitura, e marca a sugestão como `FAILED` com mensagem explícita — nunca falha silenciosamente.

Pré-requisito de negócio antes do passo 1: acesso de API aprovado pela plataforma (ver `docs/marketplace-ads-api-access-plan.md` — Shopee/TikTok têm autoatendimento; Amazon exige revisão de segurança em múltiplos estágios; Magalu exige onboarding via "Acelera com Magalu").

## 12. Sugestão via IA — Fase 4 (opcional)

Documento próprio (`docs/marketplace-ads-ai-fase4-architecture.md`) tem o desenho completo e as decisões finais; resumo aqui para quem só quer o encaixe no módulo.

`AdsAiOptimizationService` é IRMÃO de `AdsAlertingService` (Fase 2), nunca uma extensão dela: as duas criam `AdsActionSuggestion` `PENDING` pelo MESMO repositório (`ADS_ACTION_SUGGESTION_REPOSITORY`), por caminhos independentes — um determinístico (threshold de ROAS), um probabilístico (LLM, via a porta `CampaignOptimizationAdvisor` e o adapter `AnthropicCampaignAdvisor`). `AdsActionDispatcherService` (Fase 3) não foi tocado: continua sendo o único caminho que de fato chama `pauseCampaign`, sempre atrás de confirmação humana explícita — a Fase 4 não enfraquece o Safety Lock em nada, mesmo com `confidenceScore` alto.

Diferenças de cadência e origem de dado:

- Cron PRÓPRIO (`AdsAiOptimizationSchedulerJob`, `EVERY_DAY_AT_6AM`), separado do ciclo de 2h de `AdsSyncSchedulerJob` — chamada de LLM tem custo/latência que sync de métrica não tem.
- `AdsActionSuggestion` ganhou 3 campos nesta fase (`source: RULE_BASED | AI`, `confidenceScore Float?`, `metadata Json?`) — `source` é só trilha de auditoria, não muda o fluxo de aprovação.
- Meta de ROAS agora é configurável por tenant (`CatalogSettings.targetRoas`, nullable) com fallback para uma constante global (`DEFAULT_TARGET_ROAS = 3`) resolvido em `FinancialPolicyReaderService` — mesmo padrão já usado por `taxRate`/`minProfitMargin`.
- Escopo de ação desta fase: só `PAUSE_CAMPAIGN` (mesma ação que a Fase 3 já validou) — `REDUCE_BID`/`INCREASE_BUDGET` ficaram fora do MVP por decisão do usuário, sem bloqueio arquitetural para adicionar depois.

## 11. Testes

- `domain/ads-metrics.spec.ts` — 14 testes (ROAS/TACOS null-safety, 4 tiers de saúde, máquina de estado `determineAlertAction`, `shouldSuggestPauseAction`).
- `mercado-livre-ads.provider.spec.ts` — 14 testes (normalização, campos ausentes lançam erro, janela de métricas, `pauseCampaign` — Safety Lock).
- `ads-sync-orchestrator.service.spec.ts` — 10 testes (happy path, provider ausente, falha de item, falha de batch, métrica órfã, integração com alertas, falha isolada na avaliação de alertas, sugestão de ação criada em `CUSTO_PERDIDO`).
- `ads-insights.service.spec.ts` — 3 testes (dashboard combinando campanhas + TACOS).
- `ads-alerting.service.spec.ts` — 9 testes (ALERT/RESET/NONE, sem campanha, múltiplas campanhas independentes, falha isolada por campanha, sugestão criada só em ALERT, idempotência de sugestão aberta).
- `ads-action-dispatcher.service.spec.ts` — 9 testes (confirmAndApply feliz, sugestão inexistente, sugestão não-PENDING, provider ausente, provider falha, provider só-leitura ignorado, reject feliz/inválido, listPending).
- `anthropic-campaign-advisor.service.spec.ts` (Fase 4) — 10 testes (chave ausente, lista vazia sem chamar a API, happy path, 4 rejeições de validação de conteúdo, HTTP de erro, resposta sem `tool_use`).
- `ads-ai-optimization.service.spec.ts` (Fase 4) — 9 testes (sem elegíveis, happy path, confidence abaixo do mínimo default/customizado, idempotência, campaignId fora do conjunto elegível, falha da IA nunca relança, `runAll` itera/pula provider).

Total: 78 testes, todos verdes. `tsc --noEmit` limpo (zero erros novos além da limitação de sandbox já documentada — Prisma Client não gerado, sem rede para baixar engine).
