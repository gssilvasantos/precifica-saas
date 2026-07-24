import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RuleSyncOrchestrator } from '../../application/rule-sync-orchestrator.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

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
    // Bypass do envelope externo — ver docs/row-level-security-architecture.md,
    // seção 3.3. RuleSyncOrchestrator.syncFeeRules sincroniza regras de taxa
    // (marketplace_rules), tabela majoritariamente global (tenantId nulo);
    // ainda não revisado para reabrir contexto por tenant nos casos de
    // override específico (item de hardening futuro, não bloqueante).
    await TenantContextStore.runAsService(() => this.checkDueSchedulesInner());
  }

  private async checkDueSchedulesInner() {
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
