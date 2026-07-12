import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../domain/auth.types';

// Valida o token e disponibiliza { userId, tenantId, role } como request.user
// em todo controller protegido por JwtAuthGuard, de qualquer módulo.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'dev-secret-nao-usar-em-producao',
    });
  }

  validate(payload: JwtPayload) {
    return { userId: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }
}
