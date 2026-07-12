import { Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { WarehouseService } from '../../application/warehouse.service';
import { STOCK_LEDGER_REPOSITORY, StockLedgerRepository } from '../../application/ports/stock-ledger-repository.port';
import { UpdateLeadTimeDto } from '../dto/update-lead-time.dto';
import { UpdateLogisticsCostDto } from '../dto/update-logistics-cost.dto';

// Leitura — qualquer papel autenticado pode consultar depósitos e saldo
// (mesmo padrão de outras telas só-leitura da plataforma); só as ações do
// Hub de Provas (StockMovementAuditEventController) e a edição de lead time
// abaixo exigem ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics-fulfillment/warehouses')
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehouseService,
    @Inject(STOCK_LEDGER_REPOSITORY) private readonly ledger: StockLedgerRepository,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.warehouses.listByTenant(user.tenantId);
  }

  // Saldo por SKU de um depósito específico — soma de StockLedgerEntry.quantityDelta,
  // nunca uma coluna separada (ver stock-ledger.entity.ts).
  @Get(':id/balances')
  listBalances(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ledger.listBalancesByWarehouse(user.tenantId, id);
  }

  // Configuração do lead time (Sprint 25) — pedido explícito do usuário
  // para controlar a agressividade da reposição sem depender de deploy.
  // ReplenishmentAdvisorService lê este valor em toda chamada, nunca uma
  // constante fixa.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/lead-time')
  updateLeadTime(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateLeadTimeDto) {
    return this.warehouses.updateLeadTimeDays(user.tenantId, id, dto.leadTimeDays);
  }

  // Configuração do custo operacional (Sprint 26) — consumido pelo Motor de
  // Margem de Promoções via LogisticsCostReader. Sem isso preenchido, o
  // custo operacional do depósito entra como 0 no cálculo (nunca um valor
  // arbitrário) — ver logistics-cost-reader.service.ts.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/logistics-cost')
  updateLogisticsCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateLogisticsCostDto,
  ) {
    return this.warehouses.updateLogisticsCostPerUnit(user.tenantId, id, dto.logisticsCostPerUnit);
  }
}
