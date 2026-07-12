import { Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { MercadoLivreConnectionService } from '../../application/mercado-livre-connection.service';
import { MercadoLivreHandshakeService } from '../../application/mercado-livre-handshake.service';
import { MercadoLivreCallbackQueryDto } from '../dto/mercado-livre-callback-query.dto';

// Sprint 22 — fluxo OAuth2 do Mercado Livre. Três dos quatro endpoints
// exigem sessão (mesmo padrão de NuvemshopConnectionController); o quarto
// (`callback`) é deliberadamente público — ver comentário no método.
@Controller('marketplace-intelligence/mercado-livre')
export class MercadoLivreConnectionController {
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
  @Get('callback')
  async callback(@Query() query: MercadoLivreCallbackQueryDto) {
    await this.connectionService.handleCallback(query.code, query.state);
    // MVP: sem tela de confirmação dedicada ainda — devolve JSON simples.
    // Extensão futura natural: redirecionar para uma página do frontend
    // (ex. /integracoes/mercado-livre?connected=1) em vez de JSON cru.
    return { connected: true };
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
