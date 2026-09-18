import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE,
  MercadoLivreChannelListingSyncService,
} from '../../application/mercado-livre-channel-listing-sync.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

// Mesmo padrão de NuvemshopSyncSchedulerJob (erp-integration) — job leve,
// só decide SE roda (via ProviderSyncSchedule.isEnabled, um kill-switch
// operacional sem precisar de deploy) e delega todo o resto ao serviço.
// Diferença deliberada: aqui não há due-check por tenant (ver comentário em
// MercadoLivreChannelListingSyncService.syncAllTenants sobre por que
// MercadoLivreConnection não tem um lastSyncedAt hoje) — todo tenant ativo é
// sincronizado a cada execução.
@Injectable()
export class MercadoLivreChannelListingSyncSchedulerJob {
  constructor(
    private readonly sync: MercadoLivreChannelListingSyncService,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncAllTenants() {
    // Bypass do envelope externo — mesmo racional/comentário de
    // NuvemshopSyncSchedulerJob: ver docs/row-level-security-architecture.md,
    // seção 3.3. MercadoLivreChannelListingSyncService.syncAllTenants ainda
    // não foi revisado para reabrir contexto por tenant internamente.
    await TenantContextStore.runAsService(() => this.syncAllTenantsInner());
  }

  private async syncAllTenantsInner() {
    const schedule = await this.schedules.findByProviderCode(MERCADO_LIVRE_CHANNEL_LISTINGS_PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;
    await this.sync.syncAllTenants();
    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }
}
