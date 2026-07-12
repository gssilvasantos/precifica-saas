import { Module } from '@nestjs/common';
import { CompetitionRadarRegistry, COMPETITION_RADARS } from './application/competition-radar-registry.service';
import { CompetitionMonitorOrchestrator } from './application/competition-monitor-orchestrator.service';
import { CompetitiveOpportunityReaderService } from './application/competitive-opportunity-reader.service';
import { MonitoredListingsAdminService } from './application/monitored-listings-admin.service';
import { CompetitiveOpportunitiesQueryService } from './application/competitive-opportunities-query.service';

import { PrismaMonitoredListingRepository } from './infrastructure/prisma-monitored-listing.repository';
import { PrismaCompetitorOfferSnapshotRepository } from './infrastructure/prisma-competitor-offer-snapshot.repository';
import { PrismaCompetitiveOpportunityRepository } from './infrastructure/prisma-competitive-opportunity.repository';
import { ManualSheetRadar } from './infrastructure/radars/manual-sheet-radar';
import { CompetitionMonitorSchedulerJob } from './infrastructure/scheduler/competition-monitor-scheduler.job';

import { CompetitiveOpportunitiesController } from './interface/controllers/competitive-opportunities.controller';

import { MONITORED_LISTING_REPOSITORY } from './application/ports/monitored-listing-repository.port';
import { COMPETITOR_OFFER_SNAPSHOT_REPOSITORY } from './application/ports/competitor-offer-snapshot-repository.port';
import { COMPETITIVE_OPPORTUNITY_REPOSITORY } from './application/ports/competitive-opportunity-repository.port';
import { COMPETITOR_SNAPSHOT_READER } from '../../shared/contracts/tokens';
import { SyncOpsModule } from '../../shared/sync-ops/sync-ops.module';
import { ErpIntegrationModule } from '../erp-integration/erp-integration.module';

@Module({
  imports: [
    SyncOpsModule, // agenda/log/saúde — mesma infra genérica de Marketplace Intelligence e ERP Integration
    // Só para consumir CHANNEL_LISTING_READER (saber "nosso preço" no canal
    // vinculado ao MonitoredCompetitorListing) — nunca a tabela ChannelListing
    // direto. erp-integration não importa este módulo de volta: sem ciclo.
    ErpIntegrationModule,
  ],
  controllers: [CompetitiveOpportunitiesController],
  providers: [
    CompetitionRadarRegistry,
    CompetitionMonitorOrchestrator,
    CompetitiveOpportunityReaderService,
    MonitoredListingsAdminService,
    CompetitiveOpportunitiesQueryService,
    CompetitionMonitorSchedulerJob,

    ManualSheetRadar,
    // Registro central de radars (mesmo padrão do MARKETPLACE_PROVIDERS em
    // marketplace-intelligence): fonte nova de monitoramento = um arquivo
    // novo implementando CompetitionRadar + uma linha aqui. Nunca altera
    // CompetitionRadarRegistry nem CompetitionMonitorOrchestrator.
    {
      provide: COMPETITION_RADARS,
      useFactory: (manual: ManualSheetRadar) => [manual],
      inject: [ManualSheetRadar],
    },

    { provide: MONITORED_LISTING_REPOSITORY, useClass: PrismaMonitoredListingRepository },
    { provide: COMPETITOR_OFFER_SNAPSHOT_REPOSITORY, useClass: PrismaCompetitorOfferSnapshotRepository },
    { provide: COMPETITIVE_OPPORTUNITY_REPOSITORY, useClass: PrismaCompetitiveOpportunityRepository },

    // Exporta a PORTA, nunca a classe concreta — Pricing Intelligence só
    // conhece COMPETITOR_SNAPSHOT_READER + a interface CompetitorSnapshotReader.
    { provide: COMPETITOR_SNAPSHOT_READER, useExisting: CompetitiveOpportunityReaderService },
  ],
  exports: [COMPETITOR_SNAPSHOT_READER],
})
export class CompetitionIntelligenceModule {}
