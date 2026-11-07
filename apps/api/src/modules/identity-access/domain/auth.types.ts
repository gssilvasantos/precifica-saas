import { UserRole } from '@prisma/client';

// Tipos de domínio do bounded context Identity & Access. UserRole é gerado
// pelo Prisma mas tratado aqui como vocabulário de domínio compartilhado
// (papéis de usuário são um conceito estável do negócio, não um detalhe de
// persistência) — pragmatismo consciente, não acoplamento a infraestrutura.
export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  // Baked no token na hora do login, mas NÃO é mais a fonte de verdade em
  // tempo de requisição: JwtStrategy.validate() (20/10/2026, mitigação de
  // revogação — ver docs/decisions/0007-jwt-live-check.md) relê role e
  // moduleAccess do banco a cada request e ignora o que está aqui. O campo
  // continua no payload só porque ainda é lido no momento da emissão
  // (auth.service.ts) e em logs/depuração — tratar como informativo, não
  // autoritativo. ADMIN ignora moduleAccess de qualquer forma (sempre
  // acesso total, ver ModuleAccessGuard).
  moduleAccess: string[];
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  moduleAccess: string[];
}
