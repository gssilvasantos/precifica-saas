// Superfície pública do módulo Identity & Access — o único módulo verdadeiramente
// transversal da plataforma (ver docs/platform-architecture.md, seção 2).
// Outros módulos importam SOMENTE a partir daqui, nunca de dentro de
// domain/, application/ ou infrastructure/ deste módulo.
export { JwtAuthGuard } from './interface/guards/jwt-auth.guard';
export { RolesGuard } from './interface/guards/roles.guard';
export { Roles } from './interface/decorators/roles.decorator';
export { CurrentUser } from './interface/decorators/current-user.decorator';
export type { AuthenticatedUser } from './domain/auth.types';
export { UserRole } from '@prisma/client';
