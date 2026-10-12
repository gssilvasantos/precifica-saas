import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErpSyncOrchestrator, PROVIDER_CODE } from '../../application/erp-sync-orchestrator.service';
import { OlistV3SyncService } from '../../application/olist-v3-sync.service';
import { OlistV3ApiClient } from '../olist/olist-v3-api.client';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

const DEFAULT_INTERVAL_MINUTES = 60;

// Roda a cada poucos minutos e delega ao orquestrador decidir, por tenant,
// quem está vencido (ver comentário em ErpSyncOrchestrator.syncAllTenants).
// Mesmo padrão de "job leve, sem fila dedicada" do SyncSchedulerJob do
// Marketplace Intelligence — revisitar quando o número de tenants
// justificar workers dedicados.
@Injectable()
export class ErpSyncSchedulerJob {
  private readonly logger = new Logger(ErpSyncSchedulerJob.name);

  constructor(
    private readonly orchestrator: ErpSyncOrchestrator,
    private readonly v3Sync: OlistV3SyncService,
    private readonly v3Client: OlistV3ApiClient,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkDueTenants() {
    // Bypass do envelope externo — ver docs/row-level-security-architecture.md,
    // seção 3.3. ErpSyncOrchestrator.syncAllTenants ainda não foi revisado
    // para reabrir contexto por tenant internamente (item de hardening
    // futuro, não bloqueante).
    await TenantContextStore.runAsService(() => this.checkDueTenantsInner());
  }

  private async checkDueTenantsInner() {
    // Keep-alive do token v3 a cada tick (30 min), com ou sem sync v3 ligado: o refresh
    // vale 24 h e só é renovado quando alguém o usa. Falha aqui não pode barrar o sync.
    try {
      await this.v3Sync.keepAliveAll();
    } catch (error) {
      this.logger.warn(`Keep-alive do token Olist v3 falhou: ${(error as Error).message}`);
    }

    const schedule = await this.schedules.findByProviderCode(PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;

    const intervalMinutes = schedule?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    // ADR 0003: com OLIST_V3_SYNC_ENABLED o sync incremental da v3 substitui a
    // varredura completa da v2 (a v2 continua como reserva: desligar a flag volta a ela).
    if (this.v3Client.isSyncEnabled()) {
      await this.v3Sync.syncAllTenants(intervalMinutes);
    } else {
      await this.orchestrator.syncAllTenants(intervalMinutes);
    }
    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }
}
