import { Controller, Delete, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { MercadoLivreConnectionService } from '../../application/mercado-livre-connection.service';
import { MercadoLivreHandshakeService } from '../../application/mercado-livre-handshake.service';
import { MercadoLivreCallbackQueryDto } from '../dto/mercado-livre-callback-query.dto';

// Base do frontend pra onde o callback redireciona o navegador do vendedor
// de volta — nunca hardcoded, porque difere entre dev (Vite, porta 5173) e
// produção (kyneti.com.br). Fallback de dev deliberado (não usa o mesmo
// requireEnv "estourar sem a var" do resto do módulo): esse redirect é
// cosmético (o `connected: true` já funcionava sem ele), então preferimos
// degradar para localhost a quebrar o callback inteiro se a var faltar.
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';

// Sprint 22 — fluxo OAuth2 do Mercado Livre. Três dos quatro endpoints
// exigem sessão (mesmo padrão de NuvemshopConnectionController); o quarto
// (`callback`) é deliberadamente público — ver comentário no método.
@Controller('marketplace-intelligence/mercado-livre')
export class MercadoLivreConnectionController {
  private readonly logger = new Logger(MercadoLivreConnectionController.name);

  constructor(
    private readonly connectionService: MercadoLivreConnectionService,
    private readonly handshakeService: MercadoLivreHandshakeService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('status')
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.getStatus(user.tenantId);
  }

  // Passo 1 — o frontend chama isto autenticado e redireciona o navegador
  // do usuário para a `authorizeUrl` devolvida (tela de login/aprovação do
  // próprio Mercado Livre, fora da nossa aplicação).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('authorize')
  authorize(@CurrentUser() user: AuthenticatedUser) {
    return { authorizeUrl: this.connectionService.buildAuthorizationUrl(user.tenantId) };
  }

  // Passo 2 — SEM guard de propósito: o Mercado Livre redireciona o
  // navegador do vendedor para cá depois da tela de autorização, e não há
  // (nem deveria haver) um JWT nosso nesse redirect externo. A proteção
  // aqui é o `state` criptografado com o tenantId embutido (validado dentro
  // de MercadoLivreConnectionService.handleCallback), não um guard HTTP —
  // ver docs/auth-security.md.
  //
  // Antes devolvia `{ connected: true }` cru (MVP do Sprint 22) — o
  // navegador do vendedor/reviewer externo parava numa tela de JSON sem
  // nenhuma UI, mesmo com a conexão salva com sucesso. Corrigido para
  // redirecionar de volta à tela de Integrações do próprio Kyneti, com um
  // query param que a UI pode usar para uma mensagem de sucesso/erro.
  @Get('callback')
  async callback(@Query() query: MercadoLivreCallbackQueryDto, @Res() res: Response) {
    try {
      await this.connectionService.handleCallback(query.code, query.state);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?conectado=mercado-livre`);
    } catch (error) {
      this.logger.error('Falha ao processar callback do Mercado Livre', error as Error);
      res.redirect(`${FRONTEND_BASE_URL}/integracoes?erro=mercado-livre`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete('connect')
  disconnect(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.disconnect(user.tenantId);
  }

  // Fase de Conexão Real — handshake de diagnóstico (status -> renovação de
  // token -> chamada real a /orders/search), sem persistir nenhum pedido.
  // Ver o comentário de arquitetura em mercado-livre-handshake.service.ts
  // para por que isto é deliberadamente separado do pipeline de ingestão
  // real (POST /orders/providers/:providerCode/sync).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('test-connection')
  testConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.handshakeService.testConnection(user.tenantId);
  }
}
