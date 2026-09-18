# Competition Intelligence — Arquitetura

**Status:** implementado — contratos, orquestrador, radar real do Mercado Livre (`MercadoLivreCatalogRadar`, API pública de catálogo) + radar de exemplo (`ManualSheetRadar`, estrutura sem integração), eventos de domínio, um listener real no Pricing Intelligence (`CompetitorSignalListener`, calcula e pode aplicar decisão de preço) e, desde 18/09/2026, ativação automática do radar do Mercado Livre para tenants reais (seção 10) — corrige as seções 2 e 3 abaixo, que descreviam a primeira fatia (só `ManualSheetRadar`, listener stub).

## 1. Objetivo e posicionamento do módulo

Monitorar o mercado (preço de concorrentes, Buy Box) e transformar isso em **sinais** que outros módulos — hoje, principalmente o Pricing Engine (Pricing Intelligence) — podem escolher reagir ou não. Este módulo **não decide reprecificar nada**; ele só observa e emite fatos. Quem decide reagir é quem assina o evento (ver seção 3).

Bounded context: `competition_intelligence` (schema Postgres próprio).

## 2. Abstração do radar — `CompetitionRadar`

```typescript
// shared/contracts/competition-radar.contract.ts
export interface RawCompetitorOffer {
  competitorLabel: string;
  price: number;
  isBuyBoxWinner?: boolean;
  collectedAt: Date;
  sourceEvidenceRef?: string;
}

export interface CompetitionFetchContext {
  tenantId: string;
  skuCode: string;
  targetRef: string; // URL/id que o radar usa para saber o que buscar
}

export interface CompetitionRadar {
  readonly code: string;
  readonly sourceType: 'SCRAPING' | 'PARTNER_API' | 'INTERNAL_MONITORING';
  fetchOffers(ctx: CompetitionFetchContext): Promise<RawCompetitorOffer[]>;
  healthCheck(): Promise<{ status: 'UP' | 'DEGRADED' | 'DOWN'; message?: string }>;
}
```

**Por que uma interface só, ao contrário do `MarketplaceProvider`** (que tem várias capacidades segregadas — `FeeRuleCapableProvider`, `ListingCapableProvider`, etc.): lá, cada canal (Mercado Livre, Nuvemshop) tem uma superfície de API genuinamente diferente, então faz sentido segregar por capacidade. Aqui, não importa se o dado vem de scraping, de uma API paga (PriceAPI) ou de alguém digitando numa planilha — o formato do resultado que interessa ao sistema é sempre o mesmo: "estas são as ofertas que vi". Uma interface única e agnóstica é o design certo quando as fontes diferem na *implementação*, não no *formato do dado que produzem*.

`CompetitionRadarRegistry` (`application/competition-radar-registry.service.ts`) é o registro central — mesmo padrão do `MarketplaceProviderRegistry`: um radar novo = um arquivo novo implementando `CompetitionRadar` + uma linha no factory do token `COMPETITION_RADARS` no module. Nunca altera o registry nem o orquestrador.

**Radares implementados** (ordem de registro em `COMPETITION_RADARS`, `competition-intelligence.module.ts` — o do Mercado Livre vem primeiro por ser a fonte real):

- `MercadoLivreCatalogRadar` (`infrastructure/radars/mercado-livre-catalog-radar.ts`), `sourceType: PARTNER_API` — **integração real**, API pública de catálogo/Buy Box do Mercado Livre (`GET /products/{id}`, `GET /products/{id}/items`), sem OAuth. `targetRef` aceita id de produto de catálogo ou id de anúncio (resolve um a partir do outro). É a fonte de dado por trás de toda oportunidade de Buy Box real hoje na plataforma.
- `ManualSheetRadar` (`infrastructure/radars/manual-sheet-radar.ts`), `sourceType: INTERNAL_MONITORING` — estrutura, não integração real; `fetchOffers` retorna `[]` (honestidade técnica). Fallback para canais sem radar próprio.

## 3. Arquitetura orientada a eventos

Mecanismo: `@nestjs/event-emitter` (`EventEmitter2`, já registrado globalmente em `AppModule` desde a Etapa 4) — mesmo transporte in-process usado por Marketplace Intelligence. Convenção do projeto: nome do evento é uma string (não uma classe de evento), payload é um objeto tipado.

```typescript
// modules/competition-intelligence/domain/events/competition-events.ts
export const COMPETITION_EVENTS = {
  PRICE_CHANGED: 'competition.price-changed',
  BUY_BOX_LOST: 'competition.buy-box-lost',
  NEW_COMPETITOR_DETECTED: 'competition.new-competitor-detected',
} as const;
```

- **`PriceChangedEvent`** — o melhor preço de concorrente mudou em relação à última leitura processada.
- **`BuyBoxLostEvent`** — nosso `buyBoxStatus` passou para `LOSING` (de `WINNING` ou `UNKNOWN`).
- **`NewCompetitorDetectedEvent`** — o concorrente que lidera o preço mudou de identidade em relação à leitura anterior (simplificação consciente: não é uma detecção completa de qualquer concorrente novo em qualquer posição do ranking, ver comentário em `competition-monitor-orchestrator.service.ts`).

**Como o Pricing Engine assina, sem acoplamento** — a resposta prática ao "como estruturar isso no NestJS": um listener é só uma classe `@Injectable()` com métodos decorados `@OnEvent(NOME_DO_EVENTO)`, registrada como `provider` em **qualquer** módulo já carregado pela aplicação. O `EventEmitterModule` descobre esses métodos varrendo todos os providers da aplicação — **não é preciso importar o módulo que emite o evento**. Prova disso em código: `modules/pricing-intelligence/application/competitor-signal.listener.ts` importa só o arquivo de constantes/tipos `competition-events.ts` (puro dado, zero classe/token de DI) e é registrado em `PricingIntelligenceModule`, que **não importa** `CompetitionIntelligenceModule`. Se este módulo virar um serviço separado no futuro, só o transporte muda (evento in-process → fila); o listener não muda uma linha.

`PriceChangedEvent`/`NewCompetitorDetectedEvent` continuam log-only (nenhuma regra de "quando reagir" foi pedida para eles). `BuyBoxLostEvent` deixou de ser stub: `CompetitorSignalListener.handleBuyBoxLost` chama `PricingDecisionService.decideAndMaybeApply` (Pricing Intelligence) — calcula a decisão sempre, e só a **aplica** de fato (via `PRICE_UPDATE_DISPATCHER`) se `Product.autoRepricingEnabled = true`; para os demais produtos, fica log-only, mesmo comportamento de antes. Ver `docs/pricing-intelligence-architecture.md` para o motor de decisão.

## 4. Onde fica a lógica de "Oportunidade" (e a decisão de reagir)

Duas coisas diferentes, deliberadamente em lugares diferentes:

1. **Calcular a oportunidade** (diferença de preço, ranking, status de Buy Box) — função pura em `domain/opportunity-calculator.ts`, **dentro** de Competition Intelligence. Fica aqui porque é interpretação de um FATO de mercado ("quem cobra quanto agora"), não uma decisão de precificação.
2. **Decidir se isso deve disparar uma reação** (ex.: "se perdemos o Buy Box por menos de 5%, reprecificar automaticamente; se for mais, só alertar um humano") — isso é regra do **Pricing Engine**, não deste módulo. Competition Intelligence não conhece margem mínima, estratégia de preço, nem o conceito de "reagir" — ele só calcula o fato e emite o evento. Quem decide reagir é quem assina (`CompetitorSignalListener`, seção 3), e se um dia essa reação disparar reprecificação de verdade, ela vai chamar `PRICE_UPDATE_DISPATCHER` (já existente desde a Etapa 8) — nunca o inverso.

Essa fronteira é o que mantém os dois módulos desacoplados: Competition Intelligence funciona perfeitamente sem o Pricing Engine existir; ele só emite fatos para quem quiser ouvir.

```typescript
// domain/opportunity-calculator.ts (assinatura)
export function calculateOpportunity(input: {
  ourPrice: number | null;
  offers: { competitorLabel: string; price: number; isBuyBoxWinner?: boolean }[];
}): {
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  priceGapPct: number; // (ourPrice - bestCompetitorPrice) / bestCompetitorPrice
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null;
};
```

## 5. Persistência — histórico vs. read-model, deliberadamente separados

Três tabelas, três papéis (schema `competition_intelligence`):

| Tabela | Papel | Quem lê |
|---|---|---|
| `MonitoredCompetitorListing` | Configuração: o que monitorar (SKU, concorrente, radar, canal nosso opcional) | Orquestrador |
| `CompetitorOfferSnapshot` | **Histórico append-only** — uma linha por coleta. Índice por `(tenantId, skuCode, collectedAt)` | Futuro Analytics (série temporal) |
| `CompetitiveOpportunity` | **Read-model enxuto** — uma linha por `(tenantId, skuCode)`, sempre a última leitura processada (upsert) | Pricing Engine, via porta `CompetitorSnapshotReader` |

Esta é a resposta direta à pergunta "como desenhar isso para o Analytics consumir sem afetar a performance do Pricing Engine": são tabelas **fisicamente diferentes**, não a mesma tabela com dois padrões de acesso. O Pricing Engine nunca faz `SELECT` no histórico — ele consulta `CompetitiveOpportunity` por `(tenantId, skuCode)`, O(1), sempre a última leitura. O histórico completo (que cresce sem limite e serve consultas analíticas de range/série temporal) fica isolado em `CompetitorOfferSnapshot`, sem nenhum índice ou acesso otimizado para lookup pontual — ele não precisa disso, porque ninguém no caminho de precificação o lê.

Mesma disciplina de "latest known state" já usada em `ErpSyncChangeEvent` (Etapa 5), só que aqui virou duas tabelas físicas em vez de uma, porque o volume de leitura de concorrência (potencialmente várias coletas por dia por SKU) e o volume de leitura do Pricing Engine (uma consulta por decisão de preço) têm perfis de acesso realmente diferentes — vale a separação física.

```prisma
model MonitoredCompetitorListing {
  id              String   @id @default(uuid())
  tenantId        String
  skuCode         String
  competitorLabel String
  targetRef       String
  radarCode       String
  channelCode     String? // opcional: qual ChannelListing nosso comparar (nulo = buyBoxStatus fica UNKNOWN)
  isActive        Boolean  @default(true)
  @@unique([tenantId, skuCode, targetRef])
  @@schema("competition_intelligence")
}

model CompetitorOfferSnapshot {
  id              String   @id @default(uuid())
  tenantId        String
  skuCode         String
  competitorLabel String
  price           Decimal  @db.Decimal(12, 2)
  isBuyBoxWinner  Boolean?
  sourceRadarCode String
  collectedAt     DateTime
  @@index([tenantId, skuCode, collectedAt])
  @@schema("competition_intelligence")
}

model CompetitiveOpportunity {
  tenantId            String
  skuCode             String
  bestCompetitorPrice Decimal
  bestCompetitorLabel String
  ourPrice            Decimal?
  priceGapPct         Float
  buyBoxStatus        BuyBoxStatus @default(UNKNOWN)
  rank                Int?
  detectedAt          DateTime
  @@id([tenantId, skuCode])
  @@schema("competition_intelligence")
}
```

## 6. Porta de leitura consumida por outros módulos

```typescript
// shared/contracts/competitor-snapshot-reader.port.ts
export interface CompetitiveOpportunitySummary {
  skuCode: string;
  bestCompetitorPrice: number;
  bestCompetitorLabel: string;
  ourPrice: number | null;
  priceGapPct: number;
  buyBoxStatus: 'WINNING' | 'LOSING' | 'UNKNOWN';
  rank: number | null;
  detectedAt: Date;
}
export interface CompetitorSnapshotReader {
  findOpportunity(tenantId: string, skuCode: string): Promise<CompetitiveOpportunitySummary | null>;
}
```

Implementada por `CompetitiveOpportunityReaderService`, ligada ao token `COMPETITOR_SNAPSHOT_READER` (`shared/contracts/tokens.ts`) — nome já previsto em `docs/platform-architecture.md`, seção 3, desde antes deste módulo existir. Consumida hoje por `PricingDecisionService` (Pricing Intelligence, ver `docs/pricing-intelligence-architecture.md`) para calcular `MATCH_COMPETITOR`/`HOLD_PRICE`/preço de segurança a partir da melhor oferta de concorrente conhecida.

## 7. Estrutura de pastas

```
shared/contracts/
  competition-radar.contract.ts        # CompetitionRadar, RawCompetitorOffer
  competitor-snapshot-reader.port.ts   # porta consumida pelo Pricing Engine
  tokens.ts                            # + COMPETITOR_SNAPSHOT_READER

modules/competition-intelligence/
  domain/
    opportunity-calculator.ts          # cálculo puro: gap, ranking, buy box
    events/competition-events.ts       # nomes de evento + tipos de payload
  application/
    ports/
      monitored-listing-repository.port.ts
      competitor-offer-snapshot-repository.port.ts
      competitive-opportunity-repository.port.ts
    competition-radar-registry.service.ts   # + token COMPETITION_RADARS
    competition-monitor-orchestrator.service.ts
    competitive-opportunity-reader.service.ts   # implementa a porta compartilhada
    monitored-listings-admin.service.ts
    competitive-opportunities-query.service.ts
  infrastructure/
    prisma-monitored-listing.repository.ts
    prisma-competitor-offer-snapshot.repository.ts
    prisma-competitive-opportunity.repository.ts
    radars/manual-sheet-radar.ts
    scheduler/competition-monitor-scheduler.job.ts
  interface/
    dto/create-monitored-listing.dto.ts
    controllers/competitive-opportunities.controller.ts
  competition-intelligence.module.ts

modules/pricing-intelligence/
  application/competitor-signal.listener.ts   # exemplo de assinatura de evento
```

## 8. Scheduler e observabilidade

Reaproveita `shared/sync-ops` (agenda/log/saúde), a mesma infraestrutura genérica extraída na Etapa 5 para Marketplace Intelligence e ERP Integration — monitoramento de concorrência é, do ponto de vista de agendamento e observabilidade, só mais um "provider externo" (`providerCode: COMPETITION_RADAR_MONITOR`), mesmo sendo um tipo de dado totalmente diferente. `CompetitionMonitorSchedulerJob` roda a cada 10 minutos (mais frequente que sync de catálogo, porque preço de concorrente muda o dia inteiro) e delega ao orquestrador.

## 9. Receita para adicionar uma fonte de radar nova

1. Implementar `XyzRadar implements CompetitionRadar` — um arquivo novo, isolado (`infrastructure/radars/`).
2. Registrar no factory do token `COMPETITION_RADARS` em `competition-intelligence.module.ts`.
3. Cadastrar `MonitoredCompetitorListing` apontando `radarCode` para o `code` do novo radar (via `POST /competition-intelligence/monitored-listings`).

Nenhuma linha muda em `CompetitionRadarRegistry`, `CompetitionMonitorOrchestrator` ou no `opportunity-calculator.ts` — mesma disciplina já documentada para Marketplace Intelligence (seção 12 daquele doc) e ERP Integration.

## 10. Ativação do radar do Mercado Livre para tenants reais (18/09/2026)

**Objetivo:** até esta data, `MercadoLivreCatalogRadar` existia e funcionava, mas nenhum tenant real tinha `ChannelListing` nem `MonitoredCompetitorListing` cadastrados para o Mercado Livre — o motor estava correto e testado, mas sem "combustível" (nenhum SKU era monitorado). Esta fatia liga isso, e **só isso**: nenhuma escrita automática de preço em canal nenhum foi implementada (nenhum canal tem `PriceUpdateCapableProvider` registrado hoje — ver seção 16 de `docs/marketplace-intelligence-architecture.md`).

**Pipeline novo, de ponta a ponta:**

```
MercadoLivreChannelListingSyncService.syncTenant()           (marketplace-intelligence, a cada 30 min)
  -> GET /users/{sellerId}/items/search (todos os ids de anúncio do vendedor)
  -> GET /items?ids=... em lotes de 20 (preço, permalink, SKU do vendedor)
  -> upsert em ChannelListing (CHANNEL_LISTING_WRITER) por anúncio com SKU cadastrado
  -> emite CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED { tenantId, listings[] }
       (marketplace-intelligence/domain/channel-listing-events.ts — puro dado)
       |
       v
MercadoLivreChannelListingSyncedListener.handleSynced()      (competition-intelligence, assina o evento)
  -> MercadoLivreMonitoringAutoRegistrationService.reconcile()
  -> cria MonitoredCompetitorListing (radarCode MERCADO_LIVRE_CATALOG_V1, channelCode MERCADO_LIVRE)
     para todo anúncio sincronizado que ainda não tinha um registro ativo
       |
       v
CompetitionMonitorSchedulerJob (já existia, a cada 10 min)
  -> agora encontra os MonitoredCompetitorListing novos
  -> MercadoLivreCatalogRadar.fetchOffers() traz concorrência real
  -> CompetitiveOpportunity populado -> tela "Radar de Concorrência" mostra dado real
  -> se BUY_BOX_LOST: CompetitorSignalListener (Pricing Intelligence) calcula/recomenda preço (seção 3)
```

**Desacoplamento entre os dois módulos, mesma disciplina da seção 3:** o listener em Competition Intelligence importa só `marketplace-intelligence/domain/channel-listing-events.ts` (puro dado, zero classe/token de DI) — nunca uma classe concreta de Marketplace Intelligence. `CompetitionIntelligenceModule` já importava `MarketplaceIntelligenceModule` antes (só para `MercadoLivreApiClient`, usado pelo radar), então nenhum import de módulo novo foi necessário.

**Por que o evento carrega a lista de anúncios sincronizados, não só `tenantId`:** minimização de dado (`CLAUDE.md`, §6) — assim `MercadoLivreMonitoringAutoRegistrationService` nunca precisa ler `ChannelListing` diretamente (nem por uma porta nova), só reconcilia o que o payload já traz. Como `syncTenant()` sempre varre **todos** os anúncios do vendedor a cada execução (nunca só os novos), o evento também funciona como reconciliação periódica: um anúncio que por algum motivo não virou `MonitoredCompetitorListing` numa rodada é reconsiderado na próxima, sem ação manual.

**Arquivos novos:**

```
modules/marketplace-intelligence/
  domain/channel-listing-events.ts                        # CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED
  application/mercado-livre-channel-listing-sync.service.ts
  infrastructure/scheduler/mercado-livre-channel-listing-sync-scheduler.job.ts

modules/competition-intelligence/
  application/mercado-livre-monitoring-auto-registration.service.ts
  application/mercado-livre-channel-listing-synced.listener.ts
```

**Simplificações conscientes desta fatia:**

- `MercadoLivreChannelListingSyncService.syncAllTenants()` não faz "due check" por tenant (diferente do equivalente Nuvemshop) — `MercadoLivreConnection` não tem uma coluna `lastSyncedAt` hoje, só `lastRefreshedAt` (do token OAuth2). Adicionar essa coluna seria migration + RLS/grant novos para um ganho hoje irrelevante (poucos tenants com Mercado Livre conectado); o scheduler já roda no máximo a cada 30 min e toda chamada de rede passa pelo `RateLimiter`/`withRetry` do `MercadoLivreApiClient`.
- Anúncio sem SKU cadastrado no Mercado Livre (nem `seller_custom_field` nem atributo `SELLER_SKU`) é descartado do sync, não vinculado — não há como associá-lo a um `Product` do Kyneti por SKU sem inventar um.
- `MercadoLivreMonitoringAutoRegistrationService.reconcile()` só enxerga `MonitoredCompetitorListing` **ativos** (`findAllActiveByTenant`) — um listing que o usuário desativou manualmente pela tela "Radar de Concorrência" é recriado no próximo sync, como se nunca tivesse sido desligado. Resolver isso (silenciar um anúncio específico permanentemente) é uma decisão de produto separada, não implementada aqui.
- Igual à Nuvemshop, os dois novos schedulers (`MercadoLivreChannelListingSyncSchedulerJob`, e o `CompetitionMonitorSchedulerJob` que já existia) rodam sob `TenantContextStore.runAsService()` (bypass de RLS) do início ao fim do ciclo, inclusive os listeners de evento disparados durante ele — mesmo padrão já aceito e documentado nos jobs irmãos (`NuvemshopSyncSchedulerJob`, `competition-monitor-scheduler.job.ts`); hardening futuro não bloqueante, não uma exceção nova introduzida por esta fatia.

## 12. Simplificações conscientes da primeira fatia (histórico, ainda válidas)

- "Concorrente novo" é detectado por proxy simples (mudança de identidade do líder de preço), não por um conjunto persistente de labels conhecidos por SKU — documentado no código.
- `CompetitionMonitorOrchestrator.runAll()` processa todos os `MonitoredCompetitorListing` ativos a cada ciclo — não há "due check" por listing como no ERP Integration, porque o volume esperado por listing é leve; revisitar se o número de listings monitorados crescer muito.
- Sem porta de leitura de histórico para Analytics ainda (`CompetitorOfferSnapshot` não tem consumidor via porta) — o módulo Analytics ainda não existe; quando existir, ganha sua própria porta (`CompetitorHistoryReader` ou nome equivalente) apontando para essa tabela, sem que o Pricing Engine precise saber que ela existe.
- `ManualSheetRadar` continua sem integração real — nenhuma credencial/contrato com fonte de dado de concorrência fora do Mercado Livre foi validado ainda.
