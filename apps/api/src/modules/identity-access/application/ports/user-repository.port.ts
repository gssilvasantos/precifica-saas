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
  findAllByTenant(tenantId: string): Promise<User[]>;
  update(id: string, data: Partial<Pick<User, 'role' | 'moduleAccess' | 'isActive'>>): Promise<User>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
