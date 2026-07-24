import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, UserRole, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { AdsActionDispatcherService } from '../../application/ads-action-dispatcher.service';
import { AppDataMode } from '../../../../shared/contracts/order-financials-reader.port';

// Safety Lock (Fase 3): o único jeito de uma sugestão de ação virar uma
// chamada de escrita real a um marketplace é um ADMIN autenticado bater
// explicitamente em /confirm aqui. AdsAlertingService (Fase 2, roda no cron
// de sync) só CRIA a sugestão como PENDING — nunca aplica nada sozinho. Ver
// AdsActionDispatcherService e docs/marketplace-ads-architecture.md.
//
// @Roles(ADMIN) em vez de qualquer usuário autenticado: pausar uma campanha
// de ads é uma decisão financeira do negócio, mesmo padrão de acesso já
// usado em AdsSyncController.triggerSync.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marketplace-ads/actions')
export class AdsActionsController {
  constructor(private readonly dispatcher: AdsActionDispatcherService) {}

  @Get('pending')
  listPending(@CurrentUser() user: AuthenticatedUser, @Query('mode') mode?: AppDataMode) {
    return this.dispatcher.listPending(user.tenantId, mode);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatcher.confirmAndApply(user.tenantId, id, user.userId);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatcher.reject(user.tenantId, id, user.userId);
  }
}
