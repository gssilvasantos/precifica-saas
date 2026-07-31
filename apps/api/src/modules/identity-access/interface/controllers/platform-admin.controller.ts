import { Controller, Delete, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';
import { PlatformAdminService } from '../../application/platform-admin.service';

// Cross-tenant de propósito — só chega aqui quem passar por
// PlatformAdminGuard (isPlatformAdmin=true checado fresco no banco a cada
// chamada). Ver PlatformAdminService para o racional de bloquear vs excluir.
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly platformAdmin: PlatformAdminService) {}

  @Get('tenants')
  listTenants() {
    return this.platformAdmin.listTenants();
  }

  @Patch('tenants/:id/block')
  blockTenant(@Param('id') id: string) {
    return this.platformAdmin.setTenantActive(id, false);
  }

  @Patch('tenants/:id/unblock')
  unblockTenant(@Param('id') id: string) {
    return this.platformAdmin.setTenantActive(id, true);
  }

  @Delete('tenants/:id')
  deleteTenant(@Param('id') id: string) {
    return this.platformAdmin.deleteTenant(id);
  }

  @Patch('users/:id/block')
  blockUser(@Param('id') id: string) {
    return this.platformAdmin.setUserActive(id, false);
  }

  @Patch('users/:id/unblock')
  unblockUser(@Param('id') id: string) {
    return this.platformAdmin.setUserActive(id, true);
  }
}
