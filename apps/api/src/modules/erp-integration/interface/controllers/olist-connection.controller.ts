import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { OlistConnectionService } from '../../application/olist-connection.service';
import { ErpSyncOrchestrator } from '../../application/erp-sync-orchestrator.service';
import { ErpSyncEventsQueryService } from '../../application/erp-sync-events-query.service';
import { ConnectOlistDto } from '../dto/connect-olist.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('erp-integration/olist')
export class OlistConnectionController {
  constructor(
    private readonly connectionService: OlistConnectionService,
    private readonly orchestrator: ErpSyncOrchestrator,
    private readonly eventsQuery: ErpSyncEventsQueryService,
  ) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.getStatus(user.tenantId);
  }

  // Só ADMIN conecta/desconecta o ERP — é uma credencial de conta inteira,
  // não uma operação do dia a dia de precificação.
  @Roles(UserRole.ADMIN)
  @Post('connect')
  connect(@CurrentUser() user: AuthenticatedUser, @Body() dto: ConnectOlistDto) {
    return this.connectionService.connect(user.tenantId, dto.apiToken);
  }

  @Roles(UserRole.ADMIN)
  @Delete('connect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.disconnect(user.tenantId);
  }

  // Dispara uma sincronização imediata, ignorando o intervalo do scheduler —
  // útil logo após conectar, para não esperar até 60 min pelo primeiro import.
  @Roles(UserRole.ADMIN)
  @Post('sync-now')
  async syncNow(@CurrentUser() user: AuthenticatedUser) {
    await this.orchestrator.syncTenant(user.tenantId);
    return { triggered: true };
  }

  @Get('change-events')
  changeEvents(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.eventsQuery.findRecent(user.tenantId, limit ? Number(limit) : undefined);
  }
}
