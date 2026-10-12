import { Body, Controller, Delete, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
  ModuleAccessGuard,
  RequireModule,
  ModuleCode,
} from '../../../identity-access/public-api';
import { OlistV3ConnectionService } from '../../application/olist-v3-connection.service';
import { OlistV3VerificationService } from '../../application/olist-v3-verification.service';
import { readOlistV3CallbackParams } from '../dto/olist-v3-callback-params';
import { VerifyOlistV3Dto } from '../dto/verify-olist-v3.dto';

// Mesmo racional do callback do Mercado Livre: o redirect de volta é cosmético,
// com fallback de dev, e nunca carrega segredo.
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';

// Conexão OAuth2 e verificação da API v3 do Olist (ADR 0003). Tudo atrás da flag
// OLIST_V3_ENABLED (503 com código estável quando desligada). Contrato em
// docs/api/olist-v3-connection.md.
@Controller('erp-integration/olist/v3')
export class OlistV3ConnectionController {
  private readonly logger = new Logger(OlistV3ConnectionController.name);

  constructor(
    private readonly connection: OlistV3ConnectionService,
    private readonly verification: OlistV3VerificationService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @RequireModule(ModuleCode.INTEGRATIONS)
  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connection.getStatus(user.tenantId);
  }

  // Passo 1: o frontend chama autenticado e redireciona o navegador para authorizeUrl.
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @Roles(UserRole.ADMIN)
  @RequireModule(ModuleCode.INTEGRATIONS)
  @Get('authorize')
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return { authorizeUrl: this.connection.buildAuthorizationUrl(user.tenantId) };
  }

  // Passo 2: SEM guard de propósito — é o Olist quem redireciona o navegador para
  // cá, sem JWT nosso. A proteção é o `state` criptografado (tenant + validade).
  @Get('callback')
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    // Sem DTO de propósito: o Olist manda parâmetros extras (session_state, iss)
    // e a validação global recusaria o callback. Ver olist-v3-callback-params.ts.
    const params = readOlistV3CallbackParams(query);
    if (!params) {
      this.logger.warn('Callback do Olist v3 sem code/state válidos (autorização negada ou requisição malformada).');
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?erro=olist-v3`);
      return;
    }
    try {
      await this.connection.handleCallback(params.code, params.state);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?conectado=olist-v3`);
    } catch (error) {
      // Só a mensagem: o objeto de erro pode carregar corpo de resposta do provedor.
      this.logger.error(`Falha ao processar callback do Olist v3: ${(error as Error).message}`);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?erro=olist-v3`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @Roles(UserRole.ADMIN)
  @RequireModule(ModuleCode.INTEGRATIONS)
  @Delete('connect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connection.disconnect(user.tenantId);
  }

  // Somente leitura. Gasta até 7 chamadas da cota do Olist (conta inteira), por
  // isso: só ADMIN e no máximo 3 SKUs por chamada.
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
  @Roles(UserRole.ADMIN)
  @RequireModule(ModuleCode.INTEGRATIONS)
  @Post('verify')
  verify(@CurrentUser() user: AuthenticatedUser, @Body() dto: VerifyOlistV3Dto) {
    return this.verification.verify(user.tenantId, dto.skus);
  }
}
