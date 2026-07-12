import { ConflictException, Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { USER_REPOSITORY, UserRepository } from './ports/user-repository.port';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async createForTenant(
    tenantId: string,
    input: { name: string; email: string; password: string; role?: UserRole },
  ) {
    const existing = await this.users.findByTenantAndEmail(tenantId, input.email);
    if (existing) {
      throw new ConflictException('Já existe um usuário com esse e-mail nesta conta.');
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    return this.users.create({
      tenantId,
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role ?? UserRole.ADMIN,
    });
  }

  findByTenantAndEmail(tenantId: string, email: string) {
    return this.users.findByTenantAndEmail(tenantId, email);
  }

  findAllByEmail(email: string) {
    return this.users.findAllByEmail(email);
  }

  findById(id: string) {
    return this.users.findById(id);
  }
}
