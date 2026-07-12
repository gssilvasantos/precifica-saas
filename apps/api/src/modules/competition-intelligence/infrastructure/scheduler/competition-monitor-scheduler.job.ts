import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CompetitionMonitorOrchestrator, PROVIDER_CODE } from '../../application/competition-monitor-orchestrator.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';

// Monitoramento de concorrência roda com cadência própria — mais frequente
// que sync de catálogo (preço de concorrente muda o dia inteiro), mas ainda
// um job leve in-process. Reavaliar para fila dedicada (seção 9 de
// platform-architecture.md aponta Competition Intelligence como candidato
// natural a extração, justamente por ser I/O-intensivo e paralelo).
@Injectable()
export class CompetitionMonitorSchedulerJob {
  private readonly logger = new Logger(CompetitionMonitorSchedulerJob.name);

  constructor(
    private readonly orchestrator: CompetitionMonitorOrchestrator,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run() {
    const schedule = await this.schedules.findByProviderCode(PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;

    try {
      await this.orchestrator.runAll();
      if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
    } catch (error) {
      this.logger.error(`Ciclo de monitoramento de concorrência falhou: ${(error as Error).message}`);
      if (schedule) await this.schedules.markRun(schedule.id, 'FAILED', new Date());
    }
  }
}
