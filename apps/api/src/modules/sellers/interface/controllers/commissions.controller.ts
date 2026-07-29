import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { CommissionService } from '../../application/commission.service';
import { AssignVendedorItemDto } from '../dto/assign-vendedor-item.dto';
import { GenerateCommissionPayoutDto } from '../dto/generate-commission-payout.dto';

// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026, docs/sellers-architecture.md) — atribuição de vendedor a um
// item de pedido, relatório de comissão e geração de conta a pagar (repasse
// ao vendedor). Nunca no OrdersController — este bounded context só
// enxerga OrderItem através de ORDER_COMMISSION_WRITER (ver
// CommissionService), nunca a tabela nem a classe concreta de Orders.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sellers/vendedores/:vendedorId')
export class CommissionsController {
  constructor(private readonly commissions: CommissionService) {}

  // Atribuição manual explícita (Safety Lock) — nunca automática.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('atribuir-item')
  assignItem(@CurrentUser() user: AuthenticatedUser, @Param('vendedorId') vendedorId: string, @Body() dto: AssignVendedorItemDto) {
    return this.commissions.assignVendedor(user.tenantId, dto.orderId, dto.itemId, vendedorId);
  }

  // Relatório de leitura — inclui comissões já pagas (comissaoPagaEm != null).
  @Get('comissoes')
  listCommissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vendedorId') vendedorId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.commissions.listCommissions(
      user.tenantId,
      vendedorId,
      dateFrom ? new Date(dateFrom) : undefined,
      dateTo ? new Date(dateTo) : undefined,
    );
  }

  // Geração de conta a pagar (Safety Lock — ação explícita, nunca
  // automática) — soma toda comissão pendente do vendedor no período e
  // lança UMA AccountsPayable, marcando os itens envolvidos como pagos.
  @Roles(UserRole.ADMIN)
  @Post('comissoes/gerar-conta-a-pagar')
  generatePayout(@CurrentUser() user: AuthenticatedUser, @Param('vendedorId') vendedorId: string, @Body() dto: GenerateCommissionPayoutDto) {
    return this.commissions.generatePayout(user.tenantId, vendedorId, dto.dateFrom, dto.dateTo, dto.dueDate);
  }
}
