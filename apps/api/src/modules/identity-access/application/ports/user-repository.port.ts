import { UserRole } from '@prisma/client';
import { User } from '../../domain/user.entity';

export interface CreateUserData {
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface UserRepository {
  create(data: CreateUserData): Promise<User>;
  findByTenantAndEmail(tenantId: string, email: string): Promise<User | null>;
  findAllByEmail(email: string): Promise<Array<User & { tenant: { id: string; name: string } }>>;
  findById(id: string): Promise<User | null>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
