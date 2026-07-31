import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { ModuleCode } from '../../../../shared/access-control/module-code';
import { AuthenticatedUser } from '../../domain/auth.types';

// Aplica-se DEPOIS do JwtAuthGuard. Ex.:
// @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard) @RequireModule(ModuleCode.ORDERS)
//
// ADMIN sempre passa, sem checar moduleAccess — é o dono da conta (ou quem
// ele promoveu a ADMIN), acesso total é a definição do papel. A restrição
// por módulo só faz sentido para PRICING_EDITOR/VIEWER (colaboradores
// convidados pela tela de Equipe).
//
// moduleAccess vem do JWT (baked no token no login, mesmo racional de
// `role`) — não é checado fresco no banco a cada request (diferente do
// PlatformAdminGuard, que É security-crítico o bastante pra pagar esse
// custo). Revogar acesso a um módulo aqui vale a partir do próximo login do
// colaborador, não instantaneamente.
@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredModule = this.reflector.getAllAndOverride<ModuleCode>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredModule) {
      return true; // rota não declarou módulo — não é gateada por módulo
    }

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) return false;

    if (user.role === UserRole.ADMIN) return true;

    const allowed = (user.moduleAccess ?? []).includes(requiredModule);
    if (!allowed) {
      throw new ForbiddenException('Você não tem acesso a este módulo. Peça ao administrador da sua conta.');
    }
    return true;
  }
}
