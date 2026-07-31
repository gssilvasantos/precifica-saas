import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

export interface PlatformAdminUserView {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isPlatformAdmin: boolean;
}

export interface PlatformAdminTenantView {
  id: string;
  name: string;
  document: string | null;
  isActive: boolean;
  createdAt: Date;
  productCount: number;
  users: PlatformAdminUserView[];
}

// Camada de aplicação da Administração da Plataforma — todo método aqui
// SEMPRE roda dentro de TenantContextStore.runAsService (bypass de RLS),
// porque por definição isto é leitura/escrita CROSS-tenant. Nunca chame
// este serviço fora de uma rota protegida por PlatformAdminGuard.
@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  listTenants(): Promise<PlatformAdminTenantView[]> {
    return TenantContextStore.runAsService(async () => {
      const tenants = await this.prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: { users: true },
      });

      const productCounts = await this.prisma.product.groupBy({
        by: ['tenantId'],
        _count: { _all: true },
      });
      const countByTenant = new Map(productCounts.map((p) => [p.tenantId, p._count._all]));

      return tenants.map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        document: tenant.document,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        productCount: countByTenant.get(tenant.id) ?? 0,
        users: tenant.users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          isPlatformAdmin: u.isPlatformAdmin,
        })),
      }));
    });
  }

  async setTenantActive(tenantId: string, isActive: boolean): Promise<void> {
    await TenantContextStore.runAsService(async () => {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Conta não encontrada.');
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { isActive } });
    });
  }

  async setUserActive(userId: string, isActive: boolean): Promise<void> {
    await TenantContextStore.runAsService(async () => {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
    });
  }

  // Exclusão definitiva só é permitida para contas "vazias" (sem produto
  // importado/cadastrado ainda) — é exatamente o caso de uma conta criada
  // por engano (ex.: erro de digitação no e-mail do cadastro). Contas com
  // dado de negócio real usam bloqueio (setTenantActive false), nunca
  // exclusão: o cascade do Prisma só cobre identity.users (Tenant->User),
  // as ~20 outras tabelas com tenantId em outros schemas não têm FK de
  // volta para tenants (RLS isola por coluna, não por integridade
  // referencial — ver docs/row-level-security-architecture.md) e ficariam
  // órfãs, inacessíveis e nunca limpas.
  async deleteTenant(tenantId: string): Promise<void> {
    await TenantContextStore.runAsService(async () => {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Conta não encontrada.');

      const productCount = await this.prisma.product.count({ where: { tenantId } });
      if (productCount > 0) {
        throw new BadRequestException(
          `Esta conta já tem ${productCount} produto(s) cadastrado(s) — excluir deixaria dado órfão em outras ` +
            'tabelas. Use "Bloquear" em vez de excluir.',
        );
      }

      await this.prisma.tenant.delete({ where: { id: tenantId } });
    });
  }
}
