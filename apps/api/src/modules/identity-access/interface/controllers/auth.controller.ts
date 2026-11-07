import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from '../../application/auth.service';
import { SignupDto } from '../dto/signup.dto';
import { LoginDto } from '../dto/login.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthenticatedUser } from '../../domain/auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Limite mais restrito que o global (ThrottlerModule.forRoot em
  // app.module.ts, 60/60s): signup/login são os alvos óbvios de
  // brute-force/credential-stuffing/criação de conta em massa — 5
  // tentativas por minuto por IP (achado de auditoria de segurança,
  // 20/10/2026, ver docs/decisions/0005-rate-limiting-throttler.md).
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Rota de verificação: confirma que token e isolamento por tenant funcionam.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
