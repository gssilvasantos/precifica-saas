import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { OrdersService } from '../../application/orders.service';
import { OrderListQueryDto } from '../dto/order-list-query.dto';
import { AppDataMode } from '../../domain/order.entity';

// Worklist de pedidos (docs/orders-architecture.md, seção 4) — GET raiz
// alimenta a tabela com filtros de canal/status/data + paginação;
// status-counts alimenta os contadores das abas (Em aberto, Preparando
// envio, Faturado, Enviado, Entregue) sem uma query por aba. Rota estática
// 'status-counts' precisa vir ANTES de ':id' para não ser interpretada como
// um id.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findWithFilters(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderListQueryDto) {
    const { channelCode, status, dateFrom, dateTo, page = 1, pageSize = 50, mode } = query;
    return this.orders.findWithFilters(
      user.tenantId,
      {
        channelCode,
        status,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        dataMode: mode,
      },
      page,
      pageSize,
    );
  }

  // mode aceito solto (sem passar pelo OrderListQueryDto inteiro, que carrega
  // page/pageSize/filtros irrelevantes para um endpoint agregado) — mesmo
  // valor 'REAL'|'DEMO' do Audit Mode, sem validação extra: um valor
  // inválido aqui só faz isDemoFlag tratar como 'REAL' (padrão seguro).
  @Get('status-counts')
  countByStatus(@CurrentUser() user: AuthenticatedUser, @Query('mode') mode?: AppDataMode) {
    return this.orders.countByStatus(user.tenantId, mode);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.findById(user.tenantId, id);
  }

  // Etapa 19 (Orquestração de Custos) — margem real por item + agregada,
  // com fallback de custo quando o pedido não tem snapshot histórico (ver
  // OrdersService.getMarginSummary / domain/order-margin.ts).
  @Get(':id/margin')
  getMarginSummary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.orders.getMarginSummary(user.tenantId, id);
  }
}
