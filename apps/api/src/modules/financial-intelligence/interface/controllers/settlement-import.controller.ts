import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { ReceivableReconciliationService } from '../../application/receivable-reconciliation.service';
import { ImportSettlementDto } from '../dto/import-settlement.dto';

// Caminho MANUAL de reconciliação — hoje o único que existe (ver
// "honestidade técnica" em docs/financial-intelligence-architecture.md):
// não há integração automática ainda buscando relatórios de repasse direto
// da API de cada marketplace. Um futuro job/webhook por canal chamaria
// ReceivableReconciliationService.reconcile(...) no mesmo lugar — nada aqui
// muda quando isso existir.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('financial-intelligence/settlements')
export class SettlementImportController {
  constructor(private readonly reconciliation: ReceivableReconciliationService) {}

  @Roles(UserRole.ADMIN)
  @Post('import')
  import(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportSettlementDto) {
    return this.reconciliation.reconcile(user.tenantId, dto.marketplaceCode, dto.fileContent, dto.format);
  }
}
