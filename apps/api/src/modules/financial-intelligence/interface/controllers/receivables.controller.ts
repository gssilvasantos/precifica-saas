import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { ReceivablesService } from '../../application/receivables.service';
import { CreateReceivableDto } from '../dto/create-receivable.dto';
import { ReceivableStatus } from '../../domain/receivable-record.entity';

// "Meu A Receber" — leitura por status é o caminho mais comum (ex.: "o que
// ainda está PENDING", "o que já caiu como PAID neste mês"). A mudança para
// PAID nunca passa por aqui — sempre via reconciliação (ver
// SettlementImportController) — este controller é só cadastro/consulta.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('financial-intelligence/receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReceivableDto) {
    return this.receivables.create(user.tenantId, {
      ...dto,
      expectedDate: new Date(dto.expectedDate),
    });
  }

  @Get()
  findByStatus(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: ReceivableStatus) {
    return this.receivables.findByStatus(user.tenantId, status ?? 'PENDING');
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.receivables.findOne(user.tenantId, id);
  }
}
