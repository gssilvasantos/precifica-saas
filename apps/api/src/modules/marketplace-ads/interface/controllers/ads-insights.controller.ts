import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { AdsInsightsService } from '../../application/ads-insights.service';
import { AdsDashboardQueryDto } from '../dto/ads-dashboard-query.dto';
import { AppDataMode } from '../../../../shared/contracts/order-financials-reader.port';

const DEFAULT_WINDOW_DAYS = 30;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marketplace-ads')
export class AdsInsightsController {
  constructor(private readonly insights: AdsInsightsService) {}

  // Dashboard consolidado (Fase 1 — leitura): ROAS por campanha, TACOS
  // agregado, e a recomendação de tier (ESTRELA/PONTO_DE_ATENCAO/
  // CUSTO_PERDIDO/SEM_DADOS) de cada campanha. Sem filtro de data: últimos
  // 30 dias (mesma janela do AdsSyncOrchestrator). `mode` aceito solto
  // ('REAL'|'DEMO', sem validação extra) — mesmo padrão de
  // OrdersController.countByStatus: valor inválido só faz isDemoFlag tratar
  // como 'REAL' (padrão seguro).
  @Get('dashboard')
  getDashboard(@CurrentUser() user: AuthenticatedUser, @Query() query: AdsDashboardQueryDto, @Query('mode') mode?: AppDataMode) {
    const dateTo = query.dateTo ? new Date(query.dateTo) : new Date();
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : new Date(dateTo.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.insights.getDashboard(user.tenantId, dateFrom, dateTo, mode);
  }
}
