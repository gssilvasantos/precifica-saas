import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { USER_REPOSITORY, UserRepository } from './ports/user-repository.port';
import { ALL_MODULE_CODES } from '../../../shared/access-control/module-code';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async createForTenant(
    tenantId: string,
    input: { name: string; email: string; password: string; role?: UserRole; moduleAccess?: string[] },
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
      // Dono da conta (signup) sempre entra com todos os módulos marcados —
      // ADMIN ignora este campo de qualquer forma (ver ModuleAccessGuard),
      // isto é só pra não deixar o array vazio "por acidente" se um dia
      // alguém rebaixar esse usuário de ADMIN pra outro papel.
      moduleAccess: input.moduleAccess ?? ALL_MODULE_CODES,
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

  findAllByTenant(tenantId: string) {
    return this.users.findAllByTenant(tenantId);
  }

  async updateModuleAccessAndRole(
    tenantId: string,
    userId: string,
    data: { role?: UserRole; moduleAccess?: string[] },
  ) {
    const user = await this.users.findById(userId);
    if (!user || user.tenantId !== tenantId) {
      throw new NotFoundException('Usuário não encontrado nesta conta.');
    }
    return this.users.update(userId, data);
  }

  async setActive(tenantId: string, userId: string, isActive: boolean) {
    const user = await this.users.findById(userId);
    if (!user || user.tenantId !== tenantId) {
      throw new NotFoundException('Usuário não encontrado nesta conta.');
    }
    return this.users.update(userId, { isActive });
  }
}
