import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
import { ReceivableReconciliationService } from '../../application/receivable-reconciliation.service';
import { ImportSettlementDto } from '../dto/import-settlement.dto';

// Caminho MANUAL de reconciliação (upload de arquivo) — convive, desde
// 13/10/2026, com o caminho AUTOMÁTICO por webhook/API (Mercado Livre,
// topic "payments"): ver ReceivableReconciliationService.reconcileEntries,
// ChannelPaymentReconciliationOrchestrator e PaymentWebhookListener
// (financial-intelligence/application/). Os dois caminhos convergem na
// MESMA lógica de match (ReceivableReconciliationService.applyEntries,
// privado) — nunca duplicada. Este endpoint continua existindo para
// qualquer canal sem integração automática ainda (hoje: todos exceto
// Mercado Livre) e como fallback manual se o webhook falhar.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FINANCE)
@Controller('financial-intelligence/settlements')
export class SettlementImportController {
  constructor(private readonly reconciliation: ReceivableReconciliationService) {}

  @Roles(UserRole.ADMIN)
  @Post('import')
  import(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportSettlementDto) {
    return this.reconciliation.reconcile(user.tenantId, dto.marketplaceCode, dto.fileContent, dto.format);
  }
}
