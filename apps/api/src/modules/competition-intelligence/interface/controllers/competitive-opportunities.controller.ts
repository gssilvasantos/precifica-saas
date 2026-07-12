import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { MonitoredListingsAdminService } from '../../application/monitored-listings-admin.service';
import { CompetitiveOpportunitiesQueryService } from '../../application/competitive-opportunities-query.service';
import { CompetitionMonitorOrchestrator } from '../../application/competition-monitor-orchestrator.service';
import { CreateMonitoredListingDto } from '../dto/create-monitored-listing.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('competition-intelligence')
export class CompetitiveOpportunitiesController {
  constructor(
    private readonly listingsAdmin: MonitoredListingsAdminService,
    private readonly opportunities: CompetitiveOpportunitiesQueryService,
    private readonly orchestrator: CompetitionMonitorOrchestrator,
  ) {}

  @Get('opportunities')
  findOpportunities(@CurrentUser() user: AuthenticatedUser) {
    return this.opportunities.findAllByTenant(user.tenantId);
  }

  @Get('monitored-listings')
  findMonitoredListings(@CurrentUser() user: AuthenticatedUser) {
    return this.listingsAdmin.findAllByTenant(user.tenantId);
  }

  // Só ADMIN cadastra o que monitorar — decisão de configuração, não uso diário.
  @Roles(UserRole.ADMIN)
  @Post('monitored-listings')
  createMonitoredListing(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateMonitoredListingDto) {
    return this.listingsAdmin.create({ tenantId: user.tenantId, ...dto });
  }

  @Roles(UserRole.ADMIN)
  @Patch('monitored-listings/:id/deactivate')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.listingsAdmin.setActive(id, user.tenantId, false);
  }

  // Dispara um ciclo de monitoramento imediato (todos os tenants, mesma
  // limitação simples do sync-now do ERP Integration) — útil para testar
  // sem esperar o cron.
  @Roles(UserRole.ADMIN)
  @Post('run-now')
  async runNow() {
    await this.orchestrator.runAll();
    return { triggered: true };
  }
}
