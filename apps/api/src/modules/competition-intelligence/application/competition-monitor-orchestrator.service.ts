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
import { COMPETITION_EVENTS } from '../domain/events/competition-events';

export const PROVIDER_CODE = 'COMPETITION_RADAR_MONITOR';

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

  constructor(
    private readonly radars: CompetitionRadarRegistry,
    @Inject(MONITORED_LISTING_REPOSITORY) private readonly listings: MonitoredListingRepository,
    @Inject(COMPETITOR_OFFER_SNAPSHOT_REPOSITORY) private readonly snapshots: CompetitorOfferSnapshotRepository,
    @Inject(COMPETITIVE_OPPORTUNITY_REPOSITORY) private readonly opportunities: CompetitiveOpportunityRepository,
    @Inject(CHANNEL_LISTING_READER) private readonly channelListings: ChannelListingReader,
    @Inject(PROVIDER_SYNC_LOG_REPOSITORY) private readonly syncLogs: ProviderSyncLogRepository,
    @Inject(PROVIDER_HEALTH_REPOSITORY) private readonly health: ProviderHealthRepository,
    private readonly events: EventEmitter2,
  ) {}

  async runAll(): Promise<void> {
    const correlationId = randomUUID();
    const logId = await this.syncLogs.start(PROVIDER_CODE, correlationId);
    const active = await this.listings.findAllActive();
    let found = 0;
    let applied = 0;

    try {
      for (const listing of active) {
        try {
          found++;
          const changed = await this.processListing(listing);
          if (changed) applied++;
        } catch (error) {
          this.logger.error(
            `Falha ao processar monitoramento ${listing.id} (SKU ${listing.skuCode}, tenant ${listing.tenantId}): ${(error as Error).message}`,
          );
        }
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

    this.emitDiffEvents(listing, previous, result, ourPrice, detectedAt);
    return true;
  }

  private async resolveOurPrice(listing: MonitoredListing): Promise<number | null> {
    if (!listing.channelCode) return null; // sem canal vinculado — não inventa preço (buyBoxStatus fica UNKNOWN)
    const ourListing = await this.channelListings.findBySku(listing.tenantId, listing.channelCode, listing.skuCode);
    return ourListing?.currentPrice ?? null;
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
