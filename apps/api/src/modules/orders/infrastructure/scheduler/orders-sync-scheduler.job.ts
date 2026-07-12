import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderSyncOrchestrator } from '../../application/order-sync-orchestrator.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';

// Mesmo padrão de SyncSchedulerJob (Marketplace Intelligence): job leve que
// roda periodicamente e dispara sync só para os providers de ORDERS
// vencidos (ProviderSyncSchedule.capability === 'ORDERS'). Intervalo mais
// curto que o de taxas/listings (10 min) porque pedido é dado
// operacional — o vendedor precisa ver "Preparando envio" com atraso mínimo.
@Injectable()
export class OrdersSyncSchedulerJob {
  private readonly logger = new Logger(OrdersSyncSchedulerJob.name);

  constructor(
    private readonly orchestrator: OrderSyncOrchestrator,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkDueSchedules() {
    const due = await this.schedules.findDue(new Date());
    const ordersDue = due.filter((s) => s.capability === 'ORDERS');
    if (ordersDue.length === 0) return;

    this.logger.log(`${ordersDue.length} sincronização(ões) de pedidos vencida(s) — disparando.`);
    for (const schedule of ordersDue) {
      try {
        await this.orchestrator.syncProvider(schedule.providerCode);
        await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
      } catch (error) {
        this.logger.error(`Falha ao sincronizar pedidos de ${schedule.providerCode}: ${(error as Error).message}`);
        await this.schedules.markRun(schedule.id, 'FAILED', new Date());
      }
    }
  }
}
