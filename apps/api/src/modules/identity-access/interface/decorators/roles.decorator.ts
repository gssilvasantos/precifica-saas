import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

// Uso: @Roles(UserRole.ADMIN) acima de um controller/handler.
// Sem esse decorator, RolesGuard libera qualquer usuário autenticado.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
