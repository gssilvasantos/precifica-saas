import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { TenantsService } from './tenants.service';
import { UsersService } from './users.service';
import { JwtPayload } from '../domain/auth.types';

// Contratos de entrada definidos pela camada de aplicação — o controller (DTO
// de HTTP) satisfaz essas interfaces estruturalmente, mas o AuthService nunca
// importa nada da camada interface/. É essa direção que mantém a regra de
// dependência do Clean Architecture (interface depende de application, nunca
// o contrário).
export interface SignupInput {
  tenantName: string;
  tenantDocument?: string;
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  tenantId?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async signup(input: SignupInput) {
    const tenant = await this.tenants.create(input.tenantName, input.tenantDocument);
    const user = await this.users.createForTenant(tenant.id, {
      name: input.name,
      email: input.email,
      password: input.password,
      role: UserRole.ADMIN, // primeiro usuário de uma conta nova é sempre admin
    });

    return this.buildAuthResponse(user.id, tenant.id, user.role);
  }

  async login(input: LoginInput) {
    const matches = await this.users.findAllByEmail(input.email);

    if (matches.length === 0) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    let candidate = matches[0];
    if (matches.length > 1) {
      if (!input.tenantId) {
        throw new ConflictException({
          message: 'Este e-mail existe em mais de uma conta. Informe tenantId.',
          accounts: matches.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name })),
        });
      }
      const found = matches.find((m) => m.tenantId === input.tenantId);
      if (!found) {
        throw new UnauthorizedException('E-mail ou senha inválidos.');
      }
      candidate = found;
    }

    const passwordMatches = await bcrypt.compare(input.password, candidate.passwordHash);
    if (!passwordMatches || !candidate.isActive) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    return this.buildAuthResponse(candidate.id, candidate.tenantId, candidate.role);
  }

  private buildAuthResponse(userId: string, tenantId: string, role: UserRole) {
    const payload: JwtPayload = { sub: userId, tenantId, role };
    return {
      accessToken: this.jwt.sign(payload),
      user: { id: userId, tenantId, role },
    };
  }
}
