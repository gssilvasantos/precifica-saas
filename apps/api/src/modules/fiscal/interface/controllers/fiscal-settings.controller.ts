import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
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
import { FiscalSettingsService } from '../../application/fiscal-settings.service';
import { UpsertFiscalSettingsDto } from '../dto/upsert-fiscal-settings.dto';

// Configuração do emitente (Fase 3, benchmark Tiny ERP, Emissão de NF-e).
// Só ADMIN configura — envolve token de API e dados fiscais da empresa,
// mais sensível que o resto das configurações de catálogo.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.FISCAL_SETTINGS)
@Controller('fiscal/settings')
export class FiscalSettingsController {
  constructor(private readonly settings: FiscalSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.get(user.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Put()
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertFiscalSettingsDto) {
    return this.settings.upsert(user.tenantId, dto);
  }
}
