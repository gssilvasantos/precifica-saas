import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, UserRole } from '../../../identity-access/public-api';
import { RuleSyncOrchestrator } from '../../application/rule-sync-orchestrator.service';
import { MarketplaceProviderRegistry } from '../../application/marketplace-provider-registry.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marketplace-intelligence/providers')
export class MarketplaceProvidersController {
  constructor(
    private readonly orchestrator: RuleSyncOrchestrator,
    private readonly registry: MarketplaceProviderRegistry,
  ) {}

  @Get()
  list() {
    return this.registry.getAll().map((p) => ({
      code: p.code,
      marketplaceCode: p.marketplaceCode,
      sourceType: p.sourceType,
      capabilities: p.capabilities,
    }));
  }

  // "Verificar agora" — dispara o mesmo pipeline do scheduler, sob demanda.
  @Roles(UserRole.ADMIN)
  @Post(':providerCode/sync')
  async triggerSync(@Param('providerCode') providerCode: string) {
    await this.orchestrator.syncFeeRules(providerCode);
    return { triggered: true, providerCode };
  }
}
