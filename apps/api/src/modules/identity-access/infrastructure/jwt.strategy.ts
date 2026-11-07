import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../domain/auth.types';
import { UsersService } from '../application/users.service';
import { TenantContextStore } from '../../../shared/prisma/tenant-context';

// Valida o token e disponibiliza { userId, tenantId, role, moduleAccess }
// como request.user em todo controller protegido por JwtAuthGuard, de
// qualquer módulo.
//
// Falha alta na inicialização se JWT_SECRET faltar (achado de auditoria de
// segurança, 20/10/2026, skill jwt-security-review): antes havia um
// fallback silencioso para a string fixa 'dev-secret-nao-usar-em-producao'
// — se a env var fosse esquecida em qualquer ambiente, a aplicação
// continuava de pé assinando/validando tokens com um segredo conhecido e
// comitado no repositório. Isso contraria .claude/rules/security.md
// ("Falhe alto na inicialização quando faltar variável obrigatória.
// Fallback silencioso para chave de desenvolvimento em produção é
// incidente, não conveniência"). Mesmo valor/factory de
// identity-access.module.ts (JwtModule.registerAsync) — os dois precisam
// falhar juntos, senão um lado assina com um segredo e o outro valida com
// outro.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly users: UsersService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET não está definida. Configure essa variável de ambiente antes de iniciar a aplicação — ' +
          'nunca existe um valor padrão de desenvolvimento aqui (ver .env.example).',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Checagem em tempo real a cada requisição (achado de auditoria de
  // segurança — jwt-security-review, 20/10/2026, documentado até então em
  // auth.types.ts: "revogar exige novo login"). Antes, role/moduleAccess
  // vinham só do que o token tinha gravado no login — desativar um usuário,
  // mudar seu papel, revogar o acesso a um módulo ou desativar o tenant só
  // tinha efeito depois do token expirar (até JWT_EXPIRES_IN, hoje "8h").
  // Agora a fonte de verdade é o banco, consultada a cada request.
  //
  // async + leitura Prisma AQUI é delicado: guards do Nest executam ANTES
  // dos interceptors (TenantContextInterceptor, que normalmente abre o
  // TenantContextStore), então nesse ponto do pipeline o contexto de tenant
  // ainda não está aberto. Por isso a query abre o próprio contexto
  // (TenantContextStore.run), do mesmo jeito que jobs/schedulers já fazem —
  // sem isso, a extensão de RLS do Prisma rejeitaria a query por "sem
  // contexto de tenant".
  async validate(payload: JwtPayload) {
    const user = await TenantContextStore.run(payload.tenantId, () =>
      this.users.findByIdWithTenantStatus(payload.sub),
    );

    if (!user || user.tenantId !== payload.tenantId || !user.isActive || !user.tenant.isActive) {
      throw new UnauthorizedException('Sessão inválida. Faça login novamente.');
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: user.role,
      moduleAccess: user.moduleAccess ?? [],
    };
  }
}
