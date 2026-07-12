import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TenantsService } from './application/tenants.service';
import { UsersService } from './application/users.service';
import { AuthService } from './application/auth.service';
import { AuthController } from './interface/controllers/auth.controller';
import { JwtStrategy } from './infrastructure/jwt.strategy';
import { RolesGuard } from './interface/guards/roles.guard';
import { PrismaTenantRepository } from './infrastructure/prisma-tenant.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { TENANT_REPOSITORY } from './application/ports/tenant-repository.port';
import { USER_REPOSITORY } from './application/ports/user-repository.port';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret-nao-usar-em-producao',
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    TenantsService,
    UsersService,
    AuthService,
    JwtStrategy,
    RolesGuard,
    { provide: TENANT_REPOSITORY, useClass: PrismaTenantRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
  // Exporta os application services para quem precisar (hoje, só o próprio
  // módulo os usa). Guards/decorators/tipos são consumidos por outros módulos
  // via public-api.ts, não por aqui — Nest exports é sobre DI, não sobre tipos.
  exports: [AuthService, TenantsService, UsersService],
})
export class IdentityAccessModule {}
