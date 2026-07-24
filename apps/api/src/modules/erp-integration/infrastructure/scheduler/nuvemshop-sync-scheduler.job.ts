import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CHANNEL_LISTINGS_PROVIDER_CODE,
  NuvemshopChannelListingSyncService,
} from '../../application/nuvemshop-channel-listing-sync.service';
import {
  PROVIDER_SYNC_SCHEDULE_REPOSITORY,
  ProviderSyncScheduleRepository,
} from '../../../../shared/sync-ops/ports/provider-sync-schedule-repository.port';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';

const DEFAULT_INTERVAL_MINUTES = 60;

// Mesmo padrão do ErpSyncSchedulerJob — job leve, due-check por tenant via
// NuvemshopConnection.lastSyncedAt. A sincronização da TAXA de gateway
// (NuvemshopFeeRuleProvider) roda pelo scheduler do Marketplace Intelligence,
// separado deste — são dois capabilities diferentes do mesmo canal.
@Injectable()
export class NuvemshopSyncSchedulerJob {
  constructor(
    private readonly sync: NuvemshopChannelListingSyncService,
    @Inject(PROVIDER_SYNC_SCHEDULE_REPOSITORY) private readonly schedules: ProviderSyncScheduleRepository,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkDueTenants() {
    // Bypass do envelope externo — ver docs/row-level-security-architecture.md,
    // seção 3.3. NuvemshopChannelListingSyncService.syncAllTenants ainda não
    // foi revisado para reabrir contexto por tenant internamente (item de
    // hardening futuro, não bloqueante).
    await TenantContextStore.runAsService(() => this.checkDueTenantsInner());
  }

  private async checkDueTenantsInner() {
    const schedule = await this.schedules.findByProviderCode(CHANNEL_LISTINGS_PROVIDER_CODE);
    if (schedule && !schedule.isEnabled) return;
    const intervalMinutes = schedule?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    await this.sync.syncAllTenants(intervalMinutes);
    if (schedule) await this.schedules.markRun(schedule.id, 'SUCCESS', new Date());
  }
}
