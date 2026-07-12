# Competition Intelligence — Arquitetura

**Status:** implementado (primeira fatia) — contratos, orquestrador, um radar de exemplo (estrutura, sem integração externa real), eventos de domínio e um listener de exemplo no Pricing Intelligence.

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

**Radar de exemplo implementado:** `ManualSheetRadar` (`infrastructure/radars/manual-sheet-radar.ts`), `sourceType: INTERNAL_MONITORING`. É estrutura, não integração real — `fetchOffers` retorna `[]` hoje (honestidade técnica, mesmo padrão do `MercadoLivreFeeRuleProvider` na primeira entrega). É o candidato mais realista para virar funcional primeiro, porque não depende de scraping (frágil, questão de termos de uso) nem de contratar uma API paga.

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

Hoje o listener é um stub honesto (loga o sinal recebido). Nenhuma regra de "quando reagir automaticamente" foi pedida ainda — ver seção 4 sobre onde ela vai morar quando existir.

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

Implementada por `CompetitiveOpportunityReaderService`, ligada ao token `COMPETITOR_SNAPSHOT_READER` (`shared/contracts/tokens.ts`) — nome já previsto em `docs/platform-architecture.md`, seção 3, desde antes deste módulo existir. Nenhum consumidor real ainda (o Pricing Intelligence de hoje só tem o simulador de margem da Nuvemshop) — fica pronto para quando o motor de precificação completo existir.

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

## 10. Simplificações conscientes desta primeira fatia

- Nenhum radar real (scraping ou PriceAPI) foi implementado — `ManualSheetRadar` é estrutura, prova o contrato, mas retorna `[]`. É honesto: nenhuma credencial/contrato com fonte de dado de concorrência foi validado ainda.
- "Concorrente novo" é detectado por proxy simples (mudança de identidade do líder de preço), não por um conjunto persistente de labels conhecidos por SKU — documentado no código.
- `CompetitionMonitorOrchestrator.runAll()` processa todos os `MonitoredCompetitorListing` ativos a cada ciclo — não há "due check" por listing como no ERP Integration, porque o volume esperado por listing é leve; revisitar se o número de listings monitorados crescer muito.
- `CompetitorSignalListener` é um stub que só loga — nenhuma regra de "quando reagir automaticamente" foi pedida ainda; quando for, ela consome `PRICE_UPDATE_DISPATCHER` a partir daqui.
- Sem porta de leitura de histórico para Analytics ainda (`CompetitorOfferSnapshot` não tem consumidor via porta) — o módulo Analytics ainda não existe; quando existir, ganha sua própria porta (`CompetitorHistoryReader` ou nome equivalente) apontando para essa tabela, sem que o Pricing Engine precise saber que ela existe.
