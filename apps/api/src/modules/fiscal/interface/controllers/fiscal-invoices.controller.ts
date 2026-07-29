import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { FiscalInvoiceService } from '../../application/fiscal-invoice.service';
import { EmitInvoiceDto } from '../dto/emit-invoice.dto';
import { CancelInvoiceDto } from '../dto/cancel-invoice.dto';

// Emissão de NF-e (Fase 3, benchmark Tiny ERP, seção 1.1). Mesmo padrão de
// guards do resto da base: leitura liberada, escrita (emitir/cancelar)
// exige ADMIN/PRICING_EDITOR — um documento fiscal tem consequência legal,
// então nunca fica aberto a VIEWER.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fiscal/invoices')
export class FiscalInvoicesController {
  constructor(private readonly invoices: FiscalInvoiceService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('orders/:orderId/emit')
  emit(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string, @Body() dto: EmitInvoiceDto) {
    return this.invoices.emit(user.tenantId, orderId, dto);
  }

  @Get()
  listAll(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.invoices.listAll(user.tenantId, status);
  }

  @Get('orders/:orderId')
  listByOrder(@CurrentUser() user: AuthenticatedUser, @Param('orderId') orderId: string) {
    return this.invoices.listByOrder(user.tenantId, orderId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/check-status')
  checkStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.checkStatus(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(user.tenantId, id, dto.justificativa);
  }
}
