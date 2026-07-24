import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, UserRole } from '../../../identity-access/public-api';
import { AdsSyncOrchestrator } from '../../application/ads-sync-orchestrator.service';

// Trigger manual ("sincronizar agora"), além do AdsSyncSchedulerJob
// (polling periódico) — mesmo padrão de OrdersSyncController.triggerSync.
// Útil sobretudo agora, logo após o escopo advertising/product_ads ser
// aprovado no Mercado Livre: não precisa esperar até 2h pelo próximo ciclo
// do cron para ver o primeiro dado real chegando.
@Controller('marketplace-ads/providers')
export class AdsSyncController {
  constructor(private readonly orchestrator: AdsSyncOrchestrator) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post(':providerCode/sync')
  async triggerSync(@Param('providerCode') providerCode: string) {
    await this.orchestrator.syncProvider(providerCode);
    return { triggered: true, providerCode };
  }
}
