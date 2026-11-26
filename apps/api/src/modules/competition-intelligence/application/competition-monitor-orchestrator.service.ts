import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CompetitionRadarRegistry } from './competition-radar-registry.service';
import {
  MONITORED_LISTING_REPOSITORY,
  MonitoredListing,
  MonitoredListingRepository,
} from './ports/monitored-listing-repository.port';
import {
  COMPETITOR_OFFER_SNAPSHOT_REPOSITORY,
  CompetitorOfferSnapshotRepository,
} from './ports/competitor-offer-snapshot-repository.port';
import {
  COMPETITIVE_OPPORTUNITY_REPOSITORY,
  CompetitiveOpportunityRecord,
  CompetitiveOpportunityRepository,
} from './ports/competitive-opportunity-repository.port';
import {
  BUY_BOX_STATUS_CHANGE_REPOSITORY,
  BuyBoxStatusChangeRepository,
} from './ports/buy-box-status-change-repository.port';
import { CHANNEL_LISTING_READER } from '../../../shared/contracts/tokens';
import { ChannelListingReader } from '../../../shared/contracts/channel-listing-reader.port';
import {
  PROVIDER_SYNC_LOG_REPOSITORY,
  ProviderSyncLogRepository,
} from '../../../shared/sync-ops/ports/provider-sync-log-repository.port';
import {
  PROVIDER_HEALTH_REPOSITORY,
  ProviderHealthRepository,
} from '../../../shared/sync-ops/ports/provider-health-repository.port';
import { calculateOpportunity, InvalidOpportunityInputError, OpportunityResult } from '../domain/opportunity-calculator';
import { buildStatusChangeRecord } from '../domain/status-change-recorder';
import { COMPETITION_EVENTS } from '../domain/events/competition-events';

export const PROVIDER_CODE = 'COMPETITION_RADAR_MONITOR';

// Disjuntor (25/11/2026, segunda parte do mesmo incidente documentado abaixo
// em `isRunning`): a trava de execução única impede ciclos de se empilharem,
// mas um ÚNICO ciclo ainda percorre as ~1748 listagens ativas uma a uma — e
// se o Mercado Livre já está bloqueando (403 em 100% das chamadas, como
// confirmado em produção), esse ciclo sozinho gera ~1748 requisições inúteis
// a 1 req/s (~30min só de espera do rate limit) toda vez que roda, o que por
// si só pode ser volume suficiente para o bloqueio nunca ter uma janela livre
// para expirar. Corta cedo quando vê falhas consecutivas acima deste limite —
// não espera processar todas as listagens pra só então reportar FAILED.
// Falha intercalada com sucesso (listagem por listagem com problema pontual)
// NÃO aciona o disjuntor, só uma sequência longa e ininterrupta.
//
// Por tenant, não global (25/11/2026, achado pelo Gui monitorando a
// reativação manual do RM0043): com um disjuntor ÚNICO e global, um tenant
// de demonstração com dados quebrados (ex.: MLBs inexistentes, token
// inválido) gerando 403 em sequência bastava pra interromper o ciclo
// INTEIRO antes de alcançar as listagens de qualquer tenant real posicionado
// depois dele na fila — confirmado em produção: dois ciclos seguidos
// (iniciados 01:40 e 02:00 UTC) cortados aos ~13-14min, sempre pelo mesmo
// tenant demo, sem nenhuma listagem real sequer tentada depois do corte.
// Cada tenant agora tem seu próprio contador de falhas consecutivas: quando
// o de um tenant estoura o limite, só as listagens RESTANTES DAQUELE TENANT
// são puladas neste ciclo (sem tentativa) — listagens de outros tenants
// continuam sendo processadas normalmente, e o ciclo só é reportado como
// FAILED se TODAS as listagens efetivamente tentadas (de qualquer tenant)
// tiverem falhado.
const MAX_CONSECUTIVE_FAILURES = 10;

// Pipeline (docs/competition-intelligence-architecture.md, seção 3): para
// cada MonitoredCompetitorListing ativo -> radar.fetchOffers() -> grava
// histórico (CompetitorOfferSnapshot, append) -> calcula oportunidade
// (domain puro) -> compara com a leitura anterior -> upsert
// CompetitiveOpportunity (read-model) -> emite evento SE algo relevante
// mudou -> loga.
//
// Reaproveita a mesma infra genérica de agenda/log/saúde
// (shared/sync-ops) já usada por Marketplace Intelligence e ERP
// Integration — monitoramento de concorrente é só mais um "provider
// externo" do ponto de vista de agendamento/observabilidade, mesmo sendo um
// tipo de dado completamente diferente.
@Injectable()
export class CompetitionMonitorOrchestrator {
  private readonly logger = new Logger(CompetitionMonitorOrchestrator.name);

  // Bug de produção (25/11/2026, achado pelo Gui — "Oportunidades sempre com
  // os mesmos 21 SKU" + Anúncios travado em "Calculando..."): este método é
  // chamado tanto pelo cron (@Cron(EVERY_10_MINUTES), ver
  // competition-monitor-scheduler.job.ts) quanto pelo botão ATUALIZAR do
  // usuário (competitive-opportunities.controller.ts) — e NÃO existia
  // nenhuma trava contra execuções sobrepostas. Com 1748 listagens ativas e
  // até 4 chamadas HTTP por listagem ao rate limit de 1 req/s compartilhado
  // do Mercado Livre (DEFAULT_RATE_LIMIT, ver marketplace-rate-limits.ts),
  // UM ciclo completo leva ~1-2h — mais que os 10min do cron. Resultado:
  // ciclos se empilhavam indefinidamente (cada novo cron, mais cada clique
  // em ATUALIZAR, somava à mesma fila do rate limiter), gerando volume
  // contínuo e crescente de chamadas a `/products/{id}/items` do Mercado
  // Livre — o padrão exato que a proteção antiscraping deles bloqueia (ver
  // aviso em mercado-livre-api.client.ts sobre esse endpoint já ter passado
  // a exigir token). Confirmado em produção: 100% das tentativas retornando
  // HTTP 403 initerruptamente desde 23/11 14:22 (horário local), SEM nenhum
  // snapshot novo de concorrente coletado desde então — exatamente por isso
  // a tela de Oportunidades nunca via dado novo para recalcular.
  //
  // Fix: trava simples de execução única — uma segunda chamada enquanto a
  // primeira ainda está rodando é ignorada (loga e retorna), em vez de
  // empilhar. Não resolve sozinho um bloqueio que o Mercado Livre já tenha
  // aplicado do lado deles, mas elimina a causa que o provocou e evita
  // piorá-lo enquanto ele persistir.
  private isRunning = false;

  constructor(
    private readonly radars: CompetitionRadarRegistry,
    @Inject(MONITORED_LISTING_REPOSITORY) private readonly listings: MonitoredListingRepository,
    @Inject(COMPETITOR_OFFER_SNAPSHOT_REPOSITORY) private readonly snapshots: CompetitorOfferSnapshotRepository,
    @Inject(COMPETITIVE_OPPORTUNITY_REPOSITORY) private readonly opportunities: CompetitiveOpportunityRepository,
    @Inject(BUY_BOX_STATUS_CHANGE_REPOSITORY) private readonly statusChanges: BuyBoxStatusChangeRepository,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly events: EventEmitter2,
  ) {}

  async runAll(): Promise<void> {
    if (this.isRunning) {
      // Nunca empilha: ver aviso de produção acima sobre `isRunning`. Não é
      // erro (por isso não mexe em syncLogs/health) — só o cron ou o clique
      // em ATUALIZAR chegando enquanto o ciclo anterior ainda não acabou.
      this.logger.warn('runAll() ignorado: um ciclo de monitoramento de concorrência já está em andamento.');
      return;
    }

    this.isRunning = true;
    try {
      await this.runAllInternal();
    } finally {
      this.isRunning = false;
    }
  }

  private async runAllInternal(): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(PROVIDER_CODE, correlationId);
    const active = await this.listings.findAllActive();
    let found = 0;
    let applied = 0;
    let failed = 0;
    let skipped = 0;
    let lastError: Error | null = null;
    const consecutiveFailuresByTenant = new Map<string, number>();
    const brokenTenants = new Set<string>();

    try {
      for (const listing of active) {
        if (brokenTenants.has(listing.tenantId)) {
          // Disjuntor deste tenant já acionado neste ciclo — pula sem
          // tentar (ver comentário de MAX_CONSECUTIVE_FAILURES). Não conta
          // como `failed`: nunca foi de fato tentada.
          skipped++;
          continue;
        }

        try {
          found++;
          const changed = await this.processListing(listing);
          if (changed) applied++;
          consecutiveFailuresByTenant.set(listing.tenantId, 0);
        } catch (error) {
          failed++;
          lastError = error as Error;
          const tenantFailures = (consecutiveFailuresByTenant.get(listing.tenantId) ?? 0) + 1;
          consecutiveFailuresByTenant.set(listing.tenantId, tenantFailures);
          this.logger.error(
            `Falha ao processar monitoramento ${listing.id} (SKU ${listing.skuCode}, tenant ${listing.tenantId}): ${(error as Error).message}`,
          );

          if (tenantFailures >= MAX_CONSECUTIVE_FAILURES) {
            brokenTenants.add(listing.tenantId);
            this.logger.error(
              `Disjuntor acionado para o tenant ${listing.tenantId}: ${tenantFailures} falhas consecutivas. ` +
                `Pulando as listagens restantes deste tenant neste ciclo — outros tenants continuam sendo ` +
                `processados normalmente (ver comentário de MAX_CONSECUTIVE_FAILURES).`,
            );
          }
        }
      }

      if (brokenTenants.size > 0) {
        this.logger.warn(
          `Ciclo com disjuntor acionado para ${brokenTenants.size} tenant(s) (${[...brokenTenants].join(', ')}): ` +
            `${skipped} listagem(ns) pulada(s) sem tentativa neste ciclo.`,
        );
      }

      // Bug de produção (25/11/2026, mesmo achado documentado acima no
      // isRunning): falha por listagem individual era só logada — nunca
      // chegava a este nível, então runAll() sempre reportava SUCCESS pra
      // ProviderHealth/ProviderSyncLog mesmo com 100% das listagens
      // falhando (foi assim que o bloqueio do Mercado Livre ficou 2 dias
      // sem gerar nenhum alerta). `found > 0 && failed === found` = todas as
      // listagens efetivamente TENTADAS nesta execução falharam (listagens
      // puladas por disjuntor de outro tenant não contam para `found`) —
      // trata como falha real do provider, não como sucesso vazio. Com o
      // disjuntor por tenant, um tenant quebrado isolado não derruba essa
      // condição sozinho enquanto outro tenant tiver sucesso.
      if (found > 0 && failed === found) {
        throw brokenTenants.size > 0
          ? new Error(
              `Disjuntor acionado para ${brokenTenants.size} tenant(s) (${[...brokenTenants].join(', ')}) — ` +
                `todas as ${found} listagens tentadas neste ciclo falharam (último erro: ${lastError?.message ?? 'desconhecido'}).`,
            )
          : lastError ?? new Error('Todas as listagens monitoradas falharam nesta execução.');
      }

      await this.health.recordSuccess(PROVIDER_CODE);
      await this.syncLogs.finish(logId, { status: 'SUCCESS', candidatesFound: found, candidatesApplied: applied });
    } catch (error) {
      await this.health.recordFailure(PROVIDER_CODE, (error as Error).message);
      await this.syncLogs.finish(logId, {
        status: 'FAILED',
        candidatesFound: found,
        candidatesApplied: applied,
        errorDetails: (error as Error).message,
      });
      throw error;
    }
  }

  private async processListing(listing: MonitoredListing): Promise<boolean> {
    const radar = this.radars.findByCode(listing.radarCode);
    if (!radar) {
      this.logger.warn(`Nenhum radar registrado com code=${listing.radarCode} (listing ${listing.id}).`);
      return false;
    }

    const offers = await radar.fetchOffers({
      tenantId: listing.tenantId,
      skuCode: listing.skuCode,
      targetRef: listing.targetRef,
      channelCode: listing.channelCode,
    });
    if (offers.length === 0) return false; // nada coletado — não é erro, ver ManualSheetRadar

    await this.snapshots.createMany(
      offers.map((o) => ({
        tenantId: listing.tenantId,
        skuCode: listing.skuCode,
        competitorLabel: o.competitorLabel,
        price: o.price,
        isBuyBoxWinner: o.isBuyBoxWinner,
        sourceRadarCode: radar.code,
        sourceEvidenceRef: o.sourceEvidenceRef,
        collectedAt: o.collectedAt,
      })),
    );

    const ourPrice = await this.resolveOurPrice(listing);
    const previous = await this.opportunities.findByTenantAndSku(listing.tenantId, listing.skuCode);

    let result;
    try {
      result = calculateOpportunity({
        ourPrice,
        offers: offers.map((o) => ({ competitorLabel: o.competitorLabel, price: o.price, isBuyBoxWinner: o.isBuyBoxWinner })),
      });
    } catch (error) {
      if (error instanceof InvalidOpportunityInputError) {
        this.logger.warn(`${error.message} (listing ${listing.id})`);
        return false;
      }
      throw error;
    }

    const detectedAt = new Date();
    await this.opportunities.upsert({
      tenantId: listing.tenantId,
      skuCode: listing.skuCode,
      bestCompetitorPrice: result.bestCompetitorPrice,
      bestCompetitorLabel: result.bestCompetitorLabel,
      ourPrice,
      channelCode: listing.channelCode,
      priceGapPct: result.priceGapPct,
      buyBoxStatus: result.buyBoxStatus,
      rank: result.rank,
      detectedAt,
    });

    await this.recordStatusChangeIfAny(listing, previous, result, ourPrice, detectedAt);
    this.emitDiffEvents(listing, previous, result, ourPrice, detectedAt);
    return true;
  }

  private async resolveOurPrice(listing: MonitoredListing): Promise<number | null> {
    if (!listing.channelCode) return null; // sem canal vinculado — não inventa preço (buyBoxStatus fica UNKNOWN)
    const ourListing = await this.channelListings.findBySku(listing.tenantId, listing.channelCode, listing.skuCode);
    return ourListing?.currentPrice ?? null;
  }

  // Grava em CompetitiveOpportunityStatusChange sempre que buildStatusChangeRecord
  // (regra pura, domain/status-change-recorder.ts) identifica uma transição —
  // é o que sustenta "quais SKUs passaram a perder o buy box desde ontem"
  // depois do fato, sem depender de log. Roda sempre, independente de haver
  // reação automática configurada (não é o mesmo gate de BUY_BOX_LOST, que só
  // cobre -> LOSING; aqui registramos toda mudança de status).
  private async recordStatusChangeIfAny(
    listing: MonitoredListing,
    previous: CompetitiveOpportunityRecord | null,
    current: OpportunityResult,
    ourPrice: number | null,
    detectedAt: Date,
  ): Promise<void> {
    const record = buildStatusChangeRecord({
      tenantId: listing.tenantId,
      skuCode: listing.skuCode,
      channelCode: listing.channelCode ?? null,
      previousStatus: previous?.buyBoxStatus ?? null,
      result: current,
      ourPrice,
      detectedAt,
    });
    if (!record) return;

    try {
      await this.statusChanges.create(record);
    } catch (error) {
      // Falha ao gravar o histórico de transição NÃO pode derrubar o
      // pipeline principal (upsert de CompetitiveOpportunity já aconteceu) —
      // loga e segue, mesma disciplina do catch em runAll() para falha por
      // listing individual.
      this.logger.error(
        `Falha ao gravar transição de buy box para SKU ${listing.skuCode} (tenant ${listing.tenantId}): ${(error as Error).message}`,
      );
    }
  }

  private emitDiffEvents(
    listing: MonitoredListing,
    previous: CompetitiveOpportunityRecord | null,
    current: OpportunityResult,
    ourPrice: number | null,
    detectedAt: Date,
  ): void {
    const base = { tenantId: listing.tenantId, skuCode: listing.skuCode, detectedAt };

    if (!previous || previous.bestCompetitorPrice !== current.bestCompetitorPrice) {
      this.events.emit(COMPETITION_EVENTS.PRICE_CHANGED, {
        ...base,
        previousBestPrice: previous?.bestCompetitorPrice ?? null,
        newBestPrice: current.bestCompetitorPrice,
        priceGapPct: current.priceGapPct,
      });
    }

    const lostBuyBox = previous?.buyBoxStatus !== 'LOSING' && current.buyBoxStatus === 'LOSING';
    if (lostBuyBox) {
      this.events.emit(COMPETITION_EVENTS.BUY_BOX_LOST, {
        ...base,
        bestCompetitorLabel: current.bestCompetitorLabel,
        bestCompetitorPrice: current.bestCompetitorPrice,
        ourPrice,
      });
    }

    // Simplificação consciente e explícita: "concorrente novo" aqui
    // significa "o concorrente com o melhor preço mudou de identidade" em
    // relação à leitura anterior — um proxy simples e honesto para "um
    // entrante está liderando o preço", não uma detecção completa de
    // qualquer concorrente novo em qualquer posição do ranking (isso
    // exigiria persistir o conjunto de labels já vistos por SKU, o que não
    // foi pedido nesta primeira fatia).
    if (previous && previous.bestCompetitorLabel !== current.bestCompetitorLabel) {
      this.events.emit(COMPETITION_EVENTS.NEW_COMPETITOR_DETECTED, {
        ...base,
        competitorLabel: current.bestCompetitorLabel,
        competitorPrice: current.bestCompetitorPrice,
      });
    }
  }
}
