import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { ProductionOrderService } from '../../application/production-order.service';
import { CreateProductionOrderDto } from '../dto/create-production-order.dto';
import { ProductionOrderStatus } from '../../domain/production-order.entity';

// Ordens de Produção — Projeto Estruturante 1, benchmark Bling ERP,
// 29/07/2026 (docs/bling-erp-benchmark-analysis.md, seção 1.1, e
// docs/production-architecture.md). Mesmo padrão de guards de
// PurchaseOrdersController: leitura liberada pra qualquer papel autenticado,
// escrita (criar/iniciar/concluir/cancelar) exige ADMIN/PRICING_EDITOR.
//
// Gate de módulo: REPLENISHMENT — conclusão credita/debita estoque, mesma
// fronteira de Ordens de Compra.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.REPLENISHMENT)
@Controller('production/orders')
export class ProductionOrdersController {
  constructor(private readonly productionOrders: ProductionOrderService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductionOrderDto) {
    return this.productionOrders.create(user.tenantId, { ...dto, notes: dto.notes ?? null });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: ProductionOrderStatus) {
    return this.productionOrders.list(user.tenantId, { status });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productionOrders.findOne(user.tenantId, id);
  }

  // RASCUNHO -> EM_ANDAMENTO (situação: "em produção").
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/iniciar')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productionOrders.start(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/cancelar')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productionOrders.cancel(user.tenantId, id);
  }

  // Conclusão — debita os componentes (snapshot da BOM) e credita o produto
  // acabado, atomicamente (ver ProductionOrderService.conclude).
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/concluir')
  conclude(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.productionOrders.conclude(user.tenantId, id, user.userId);
  }
}
