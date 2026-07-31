import { BadRequestException, Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
  ModuleAccessGuard,
  RequireModule,
  ModuleCode,
} from '../../../identity-access/public-api';
import { OlistConnectionService } from '../../application/olist-connection.service';
import { ErpSyncOrchestrator } from '../../application/erp-sync-orchestrator.service';
import { ErpSyncEventsQueryService } from '../../application/erp-sync-events-query.service';
import { ConnectOlistDto } from '../dto/connect-olist.dto';

@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.INTEGRATIONS)
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
  // 31/07/2026 — antes disparava e retornava {triggered:true} mesmo quando a
  // sincronização falhava por baixo dos panos (ver comentário em
  // ErpSyncOrchestrator.syncTenant). Agora lê o resultado real e devolve o
  // erro pro frontend — syncMutation.isError no OlistConnectionCard já
  // renderiza extractErrorMessage(syncMutation.error), só faltava o backend
  // propagar a mensagem de verdade.
  @Roles(UserRole.ADMIN)
  @Post('sync-now')
  async syncNow(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.orchestrator.syncTenant(user.tenantId);
    if (!result.success) {
      throw new BadRequestException(result.error ?? 'Falha desconhecida ao sincronizar com o Olist.');
    }
    return { triggered: true };
  }

  @Get('change-events')
  changeEvents(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.eventsQuery.findRecent(user.tenantId, limit ? Number(limit) : undefined);
  }
}
