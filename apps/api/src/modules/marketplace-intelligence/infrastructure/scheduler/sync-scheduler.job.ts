import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RuleSyncOrchestrator } from '../../application/rule-sync-orchestrator.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';

// Job leve que roda a cada poucos minutos e dispara sync só para os
// providers vencidos (ProviderSyncSchedule.intervalMinutes) — em vez de um
// job dedicado por provider no BullMQ. Suficiente para o volume atual (1
// provider); vira fila com workers dedicados quando o número de
// providers/marketplaces justificar (docs/marketplace-intelligence-architecture.md,
// seção 8).
@Injectable()
export class SyncSchedulerJob {
  private readonly logger = new Logger(SyncSchedulerJob.name);

  constructor(
    private readonly orchestrator: RuleSyncOrchestrator,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkDueSchedules() {
    const due = await this.schedules.findDue(new Date());
    if (due.length === 0) return;

    this.logger.log(`${due.length} sincronização(ões) vencida(s) — disparando.`);
    for (const schedule of due) {
      if (schedule.capability === 'FEE_RULES') {
        await this.orchestrator.syncFeeRules(schedule.providerCode);
      }
    }
  }
}
