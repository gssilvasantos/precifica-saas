import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ErpSyncOrchestrator, PROVIDER_CODE } from '../../application/erp-sync-orchestrator.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';

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
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkDueTenants() {
    const schedule = await this.schedules.findByProviderCode(PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;

    const intervalMinutes = schedule?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    await this.orchestrator.syncAllTenants(intervalMinutes);
    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }
}
