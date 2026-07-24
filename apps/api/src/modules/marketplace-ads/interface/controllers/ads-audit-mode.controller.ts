import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, UserRole, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { AdsAuditSeederService } from '../../application/ads-audit-seeder.service';

// Modo de Demonstração / Audit Mode do módulo de Ads — mesmo padrão de
// AuditModeController (Orders): endpoint dedicado, ADMIN-only, delegando
// tudo para AdsAuditSeederService. Rota separada de /audit-mode (Orders)
// porque cada módulo semeia o próprio domínio — o frontend (AppModeToggle)
// chama os dois em sequência num único clique de "Semear dados de
// demonstração", ver docs/audit-mode.md.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('marketplace-ads/audit-mode')
export class AdsAuditModeController {
  constructor(private readonly auditSeeder: AdsAuditSeederService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.getStatus(user.tenantId);
  }

  @Post('seed')
  seed(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.seed(user.tenantId);
  }

  @Post('clear')
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.clear(user.tenantId);
  }
}
