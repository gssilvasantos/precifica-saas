import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
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
import { FiscalMarketplaceIntermediaryService } from '../../application/fiscal-marketplace-intermediary.service';
import { UpsertFiscalMarketplaceIntermediaryDto } from '../dto/upsert-fiscal-marketplace-intermediary.dto';

// Grupo G da NF-e (NT 2020.006) — benchmark Bling, 29/07/2026, seção 1.4.
// Só ADMIN configura — mesmo racional de FiscalSettingsController (dado
// fiscal sensível, com consequência legal na emissão).
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FISCAL_SETTINGS)
@Controller('fiscal/marketplace-intermediaries')
export class FiscalMarketplaceIntermediariesController {
  constructor(private readonly intermediaries: FiscalMarketplaceIntermediaryService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.intermediaries.listForTenant(user.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Put()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertFiscalMarketplaceIntermediaryDto) {
    return this.intermediaries.upsert(user.tenantId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':channelCode')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('channelCode') channelCode: string) {
    return this.intermediaries.remove(user.tenantId, channelCode);
  }
}
