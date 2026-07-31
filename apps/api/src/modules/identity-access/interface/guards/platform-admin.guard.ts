import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { TenantContextStore } from '../../../../shared/prisma/tenant-context';
import { AuthenticatedUser } from '../../domain/auth.types';

// Guard separado de RolesGuard de propósito: UserRole (ADMIN/PRICING_EDITOR/
// VIEWER) é um papel DENTRO de um tenant; isPlatformAdmin é uma capacidade
// FORA do conceito de tenant (enxergar/bloquear/excluir contas de clientes).
// Roda sempre depois de JwtAuthGuard (precisa de request.user já populado).
//
// Checa isPlatformAdmin fresco no banco a cada request, nunca a partir do
// JWT — revogar acesso de administração não pode depender do usuário
// deslogar e logar de novo (o token continua válido até expirar).
//
// Bypass estreito e explícito (TenantContextStore.runAsService): esta é
// exatamente a mesma situação dos schedulers (ver
// docs/row-level-security-architecture.md, seção 3.3) — precisa ler o
// próprio usuário ANTES de saber se ele tem permissão de sair do escopo do
// seu tenant. O restante das consultas de PlatformAdminService reabre o
// bypass caso a caso, nunca fica "vazando" para o resto da requisição.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return false;

    const isPlatformAdmin = await TenantContextStore.runAsService(async () => {
      const record = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { isPlatformAdmin: true },
      });
      return record?.isPlatformAdmin ?? false;
    });

    if (!isPlatformAdmin) {
      throw new ForbiddenException('Acesso restrito à administração da plataforma.');
    }
    return true;
  }
}
