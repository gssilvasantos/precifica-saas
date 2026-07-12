import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { PackagingUsageEventsService } from '../../application/packaging-usage-event.service';
import { RecordPackagingUsageDto } from '../dto/record-packaging-usage.dto';

// Endpoint MANUAL — ver comentário em PackagingUsageEventsService. Enquanto
// não existir um módulo de Vendas/Pedidos, este é o único jeito de registrar
// consumo de embalagem (ex.: um script de importação de vendas históricas,
// ou um teste manual do fluxo de DRE).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('packaging-usage-events')
export class PackagingUsageEventController {
  constructor(private readonly usageEvents: PackagingUsageEventsService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordPackagingUsageDto) {
    return this.usageEvents.record(user.tenantId, dto);
  }

  @Get('product/:productId')
  findByProduct(@CurrentUser() user: AuthenticatedUser, @Param('productId') productId: string) {
    return this.usageEvents.findByProduct(user.tenantId, productId);
  }
}
