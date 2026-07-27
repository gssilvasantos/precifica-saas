import { Controller, Delete, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { ShopeeConnectionService } from '../../application/shopee-connection.service';
import { ShopeeHandshakeService } from '../../application/shopee-handshake.service';
import { ShopeeCallbackQueryDto } from '../dto/shopee-callback-query.dto';

// Mesmo racional de fallback de MercadoLivreConnectionController — redirect
// cosmético, nunca deve quebrar o callback inteiro por falta da var.
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';

// Integração Shopee Open Platform (27/07/2026) — mesma estrutura de
// MercadoLivreConnectionController: três endpoints exigem sessão, o quarto
// (`callback`) é deliberadamente público.
@Controller('marketplace-intelligence/shopee')
export class ShopeeConnectionController {
  private readonly logger = new Logger(ShopeeConnectionController.name);

  constructor(
    private readonly connectionService: ShopeeConnectionService,
    private readonly handshakeService: ShopeeHandshakeService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.getStatus(user.tenantId);
  }

  // Passo 1 — o frontend chama isto autenticado e redireciona o navegador
  // do usuário para a `authorizeUrl` devolvida (tela de login/aprovação da
  // própria Shopee, fora da nossa aplicação).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('authorize')
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return { authorizeUrl: this.connectionService.buildAuthorizationUrl(user.tenantId) };
  }

  // Passo 2 — SEM guard de propósito: a Shopee redireciona o navegador do
  // lojista para cá depois da tela de autorização, sem JWT nosso nesse
  // redirect externo. A proteção é o `state` criptografado com o tenantId
  // embutido (validado dentro de ShopeeConnectionService.handleCallback),
  // não um guard HTTP — mesmo racional de MercadoLivreConnectionController.
  @Get('callback')
  async callback(@Query() query: ShopeeCallbackQueryDto, @Res() res: Response) {
    try {
      await this.connectionService.handleCallback(query.code, query.shop_id, query.state);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?conectado=shopee`);
    } catch (error) {
      this.logger.error('Falha ao processar callback da Shopee', error as Error);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?erro=shopee`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('connect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.disconnect(user.tenantId);
  }

  // Handshake de diagnóstico (status -> renovação de token -> chamada real a
  // /shop/get_shop_info), sem persistir nenhum pedido/produto — mesmo
  // racional de MercadoLivreConnectionController.testConnection, ver
  // shopee-handshake.service.ts.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('test-connection')
  testConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.handshakeService.testConnection(user.tenantId);
  }
}
