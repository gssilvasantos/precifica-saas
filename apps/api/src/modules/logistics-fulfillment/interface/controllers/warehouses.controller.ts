import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
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
import { WarehouseService } from '../../application/warehouse.service';
import { ProductWarehouseLocationService } from '../../application/product-warehouse-location.service';
import { UpdateLeadTimeDto } from '../dto/update-lead-time.dto';
import { UpdateLogisticsCostDto } from '../dto/update-logistics-cost.dto';
import { SetProductLocationDto } from '../dto/set-product-location.dto';

// Leitura — qualquer papel autenticado pode consultar depósitos e saldo
// (mesmo padrão de outras telas só-leitura da plataforma); só as ações do
// Hub de Provas (StockMovementAuditEventController) e a edição de lead time
// abaixo exigem ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.REPLENISHMENT)
@Controller('logistics-fulfillment/warehouses')
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehouseService,
    private readonly locations: ProductWarehouseLocationService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.warehouses.listByTenant(user.tenantId);
  }

  // Saldo por SKU de um depósito específico. Quick Win 3 (benchmark Bling,
  // 29/07/2026) — cada linha agora traz `balance` (saldoFisico, campo já
  // existente, nunca renomeado) mais `reserved`/`available` (saldoVirtual):
  // o que já está comprometido com pedidos aguardando conferência e o que
  // ainda pode ser prometido a um cliente novo. Ver domain/stock-balance.ts.
  @Get(':id/balances')
  listBalances(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.warehouses.listStockBalances(user.tenantId, id);
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

  // Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md,
  // seção 1.6) — localização física (corredor/prateleira/bin) do SKU dentro
  // deste depósito. Leitura liberada pra qualquer papel autenticado (mesmo
  // racional de list/listBalances acima); escrita exige ADMIN/PRICING_EDITOR,
  // mesmo padrão de lead-time/logistics-cost.
  @Get(':id/locations')
  listLocations(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.locations.listByWarehouse(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Put(':id/locations/:skuCode')
  setLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('skuCode') skuCode: string,
    @Body() dto: SetProductLocationDto,
  ) {
    return this.locations.setLocation(user.tenantId, id, skuCode, dto.location);
  }
}
