import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE,
  ShopeeChannelListingSyncService,
} from '../../application/shopee-channel-listing-sync.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

// Mesmo padrão de MercadoLivreChannelListingSyncSchedulerJob (ver aquele
// arquivo para o racional completo) — job leve, só decide SE roda (via
// ProviderSyncSchedule.isEnabled, kill-switch operacional sem deploy) e
// delega todo o resto ao serviço.
@Injectable()
export class ShopeeChannelListingSyncSchedulerJob {
  constructor(
    private readonly sync: ShopeeChannelListingSyncService,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncAllTenants() {
    await TenantContextStore.runAsService(() => this.syncAllTenantsInner());
  }

  private async syncAllTenantsInner() {
    const schedule = await this.schedules.findByProviderCode(SHOPEE_CHANNEL_LISTINGS_PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;
    await this.sync.syncAllTenants();
    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }
}
