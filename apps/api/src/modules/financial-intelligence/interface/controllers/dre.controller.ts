import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { FinancialOrchestrator } from '../../application/financial-orchestrator.service';
import { DreQueryDto } from '../dto/dre-query.dto';

// DRE por canal (Etapa 20) — consumido pelo Dashboard para o gráfico de
// barras comparativo de lucratividade entre marketplaces (docs/financial-intelligence-architecture.md).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('financial-intelligence/dre')
export class DreController {
  constructor(private readonly orchestrator: FinancialOrchestrator) {}

  @Get()
  generate(@CurrentUser() user: AuthenticatedUser, @Query() query: DreQueryDto) {
    return this.orchestrator.generateDreReport(
      user.tenantId,
      query.dateFrom ? new Date(query.dateFrom) : undefined,
      query.dateTo ? new Date(query.dateTo) : undefined,
      query.mode,
    );
  }
}
