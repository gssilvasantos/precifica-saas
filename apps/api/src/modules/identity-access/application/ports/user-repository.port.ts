import { UserRole } from '@prisma/client';
import { User } from '../../domain/user.entity';

export interface CreateUserData {
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  moduleAccess: string[];
}

export interface UserRepository {
  create(data: CreateUserData): Promise<User>;
  findByTenantAndEmail(tenantId: string, email: string): Promise<User | null>;
  findAllByEmail(email: string): Promise<Array<User & { tenant: { id: string; name: string; isActive: boolean } }>>;
  findById(id: string): Promise<User | null>;
  // Usado só por JwtStrategy.validate() (20/10/2026 — mitigação de
  // revogação, ver docs/decisions/0007-jwt-live-check.md): confere o estado
  // ATUAL do usuário e do tenant a cada requisição autenticada, em vez de
  // confiar ciegamente no role/moduleAccess gravados no token na hora do
  // login. Método separado de findById (que não inclui o tenant) para não
  // mudar a forma do retorno nos outros usos já existentes.
  findByIdWithTenantStatus(id: string): Promise<(User & { tenant: { isActive: boolean } }) | null>;
  findAllByTenant(tenantId: string): Promise<User[]>;
  update(id: string, data: Partial<Pick<User, 'role' | 'moduleAccess' | 'isActive'>>): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
