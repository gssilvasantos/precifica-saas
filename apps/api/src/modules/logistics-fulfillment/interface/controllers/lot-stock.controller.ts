import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { StockMovementAuditEventService } from '../../application/stock-movement-audit-event.service';
import { LotAvailabilityService } from '../../application/lot-availability.service';
import { AdjustLotDto } from '../dto/adjust-lot.dto';

// Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP, 29/07/2026)
// — lado "estoque" do lote: lançamento manual (Entrada/Saída/Balanço),
// saldo por lote/depósito, e sugestão FEFO. O cadastro do lote em si
// (metadado: validade, diasPermitidoVenda) mora no Catalog
// (POST/GET /products/:id/lots) — este controller nunca cria lote, só
// movimenta/consulta o ledger de um lote já cadastrado.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('logistics-fulfillment/lot-stock')
export class LotStockController {
  constructor(
    private readonly auditEvents: StockMovementAuditEventService,
    private readonly availability: LotAvailabilityService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('adjustments')
  adjust(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdjustLotDto) {
    return this.auditEvents.adjustLot(
      user.tenantId,
      dto.warehouseId,
      dto.skuCode,
      dto.lotCode,
      dto.movementType,
      dto.quantity,
      user.userId,
      dto.notes,
    );
  }

  // Saldo por lote de um SKU num depósito — soma de StockLedgerEntry
  // filtrando por lotCode, combinada com o metadado (validade, status).
  @Get('warehouses/:warehouseId/skus/:skuCode/balances')
  getBalances(@CurrentUser() user: AuthenticatedUser, @Param('warehouseId') warehouseId: string, @Param('skuCode') skuCode: string) {
    return this.availability.getLotBalances(user.tenantId, warehouseId, skuCode);
  }

  // Sugestão FEFO — de quais lotes tirar `quantity` unidades agora. Só
  // sugestão, não grava nada (ver LotAvailabilityService.suggestFefoConsumption).
  @Get('warehouses/:warehouseId/skus/:skuCode/fefo-suggestion')
  suggestFefo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('warehouseId') warehouseId: string,
    @Param('skuCode') skuCode: string,
    @Query('quantity') quantity: string,
  ) {
    return this.availability.suggestFefoConsumption(user.tenantId, warehouseId, skuCode, Number(quantity));
  }
}
