import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateUserData, UserRepository } from '../application/ports/user-repository.port';
import { User } from '../domain/user.entity';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateUserData) {
    return this.prisma.user.create({ data });
  }

  findByTenantAndEmail(tenantId: string, email: string) {
    return this.prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
  }

  findAllByEmail(email: string) {
    return this.prisma.user.findMany({ where: { email }, include: { tenant: true } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findAllByTenant(tenantId: string) {
    return this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  update(id: string, data: Partial<Pick<User, 'role' | 'moduleAccess' | 'isActive'>>) {
    return this.prisma.user.update({ where: { id }, data });
  }
}
