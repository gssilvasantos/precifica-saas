import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { AuditSeederService } from '../../application/audit-seeder.service';

// Modo de Demonstração / Audit Mode (ver docs/audit-mode.md) — os três
// endpoints são ADMIN-only: semear/limpar dados fictícios é uma operação
// de infraestrutura de teste, não uma ação do dia a dia de um operador
// comum, mesmo racional do toggle "acessível apenas para Admin" pedido
// para o Dashboard.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('audit-mode')
export class AuditModeController {
  constructor(private readonly auditSeeder: AuditSeederService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.getStatus(user.tenantId);
  }

  // Idempotente — chamar de novo não duplica os 10 pedidos, só atualiza.
  @Post('seed')
  seed(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.seed(user.tenantId);
  }

  @Post('clear')
  clear(@CurrentUser() user: AuthenticatedUser) {
    return this.auditSeeder.clear(user.tenantId);
  }
}
