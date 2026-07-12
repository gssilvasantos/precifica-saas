import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { ReplenishmentAdvisorService } from '../../application/replenishment-advisor.service';
import { ReplenishmentQueryDto } from '../dto/replenishment-query.dto';

// O "painel de comando" de abastecimento pedido pelo usuário — leitura pura
// (nunca escreve estoque), qualquer papel autenticado pode consultar, mesmo
// padrão de WarehousesController.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics-fulfillment/replenishment')
export class ReplenishmentController {
  constructor(private readonly advisor: ReplenishmentAdvisorService) {}

  @Get()
  getTable(@CurrentUser() user: AuthenticatedUser, @Query() query: ReplenishmentQueryDto) {
    return this.advisor.getReplenishmentTable(user.tenantId, query.channelCode);
  }
}
