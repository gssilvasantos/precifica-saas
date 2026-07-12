import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Aplica-se DEPOIS do JwtAuthGuard (precisa de request.user já preenchido).
// Ex.: @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.ADMIN)
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // rota não exige papel específico, só autenticação
    }

    const { user } = context.switchToHttp().getRequest();
    const allowed = Boolean(user) && requiredRoles.includes(user.role);

    if (!allowed) {
      throw new ForbiddenException('Você não tem permissão para executar essa ação.');
    }
    return true;
  }
}
