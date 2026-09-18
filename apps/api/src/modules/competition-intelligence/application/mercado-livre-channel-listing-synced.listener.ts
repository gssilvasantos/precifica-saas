import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHANNEL_LISTING_EVENTS,
  MercadoLivreChannelListingsSyncedEvent,
} from '../../marketplace-intelligence/domain/channel-listing-events';
import { MercadoLivreMonitoringAutoRegistrationService } from './mercado-livre-monitoring-auto-registration.service';

// Mesma disciplina de desacoplamento de CompetitorSignalListener/
// PackagingCostChangeListener (pricing-intelligence): importa só o arquivo
// de eventos do Marketplace Intelligence (puro dado, zero I/O), nunca uma
// classe concreta daquele módulo. Quem traz MarketplaceIntelligenceModule
// para dentro do grafo de DI é o competition-intelligence.module.ts
// (necessário de qualquer forma, por causa de MercadoLivreApiClient — ver
// aquele módulo), não este listener.
//
// Contexto de tenant herdado do chamador (18/09/2026): este evento é sempre
// emitido de dentro de MercadoLivreChannelListingSyncSchedulerJob, que roda
// sob TenantContextStore.runAsService() (bypass de RLS) — mesmo padrão já
// aceito para COMPETITION_EVENTS/CompetitorSignalListener (ver comentário em
// competition-monitor-scheduler.job.ts). MonitoredListingRepository/Prisma
// aceitam esse bypass da mesma forma que o resto do pipeline de
// monitoramento já aceita hoje; não é uma exceção nova.
@Injectable()
export class MercadoLivreChannelListingSyncedListener {
  private readonly logger = new Logger(MercadoLivreChannelListingSyncedListener.name);

  constructor(private readonly autoRegistration: MercadoLivreMonitoringAutoRegistrationService) {}

  @OnEvent(CHANNEL_LISTING_EVENTS.MERCADO_LIVRE_SYNCED)
  async handleSynced(payload: MercadoLivreChannelListingsSyncedEvent): Promise<void> {
    try {
      const { created } = await this.autoRegistration.reconcile(payload.tenantId, payload.listings);
      this.logger.log(
        `Tenant ${payload.tenantId}: reconciliação de monitoramento concluída (${payload.listings.length} anúncio(s) sincronizado(s), ${created} novo(s) registro(s)).`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao reconciliar monitoramento de concorrência para o tenant ${payload.tenantId}: ${(error as Error).message}`,
      );
    }
  }
}
