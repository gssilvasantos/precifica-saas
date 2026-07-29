import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { PurchaseOrderService } from '../../application/purchase-order.service';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from '../dto/receive-purchase-order.dto';
import { PurchaseOrderStatus } from '../../domain/purchase-order.entity';

// "Ordens de Compra" — benchmark Tiny ERP (28/07/2026,
// docs/tiny-erp-benchmark-analysis.md, seção 1.3). Mesmo padrão de guards de
// AccountsPayableController: leitura liberada pra qualquer papel
// autenticado, escrita (criar/avançar/receber/cancelar) exige ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procurement/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrderService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(user.tenantId, {
      ...dto,
      paymentDueDate: new Date(dto.paymentDueDate),
    });
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: PurchaseOrderStatus,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.purchaseOrders.list(user.tenantId, { status, supplierId });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchaseOrders.findOne(user.tenantId, id);
  }

  // ABERTO -> ANDAMENTO (situação: "em negociação/trânsito com o fornecedor").
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/avancar')
  advance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchaseOrders.advance(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/cancelar')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchaseOrders.cancel(user.tenantId, id);
  }

  // Recebimento — credita estoque no depósito de destino E lança a conta a
  // pagar do fornecedor, atomicamente (ver PurchaseOrderService.receive).
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/receber')
  receive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.purchaseOrders.receive(user.tenantId, id, dto.invoiceNumber, user.userId);
  }
}
