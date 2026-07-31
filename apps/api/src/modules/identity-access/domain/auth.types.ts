import { UserRole } from '@prisma/client';

// Tipos de domínio do bounded context Identity & Access. UserRole é gerado
// pelo Prisma mas tratado aqui como vocabulário de domínio compartilhado
// (papéis de usuário são um conceito estável do negócio, não um detalhe de
// persistência) — pragmatismo consciente, não acoplamento a infraestrutura.
export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  // Baked no token, mesmo racional de `role` — revogar exige novo login (ver
  // ModuleAccessGuard). ADMIN ignora este campo (sempre acesso total).
  moduleAccess: string[];
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  moduleAccess: string[];
}
