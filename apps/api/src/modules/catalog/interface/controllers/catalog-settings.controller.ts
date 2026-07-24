import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { CatalogSettingsService } from '../../application/catalog-settings.service';
import { UpdateCatalogSettingsDto } from '../dto/update-catalog-settings.dto';
import { UpdateFinancialPolicyDto } from '../dto/update-financial-policy.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('catalog/settings')
export class CatalogSettingsController {
  constructor(private readonly settings: CatalogSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getDefaultMargins(user.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Put()
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCatalogSettingsDto) {
    return this.settings.updateDefaultMargins(user.tenantId, dto.desiredMarginPct, dto.minimumMarginPct);
  }

  // Rotas separadas de propósito (não dentro de GET/PUT acima): governança
  // financeira (imposto + margem líquida mínima global) é um conceito
  // diferente do piso por SKU acima — ver comentário no schema.prisma.
  @Get('financial-policy')
  getFinancialPolicy(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getFinancialPolicy(user.tenantId);
  }

  @Roles(UserRole.ADMIN)
  @Put('financial-policy')
  updateFinancialPolicy(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateFinancialPolicyDto) {
    return this.settings.updateFinancialPolicy(user.tenantId, dto.taxRatePct, dto.minProfitMarginPct, dto.targetRoas);
  }
}
