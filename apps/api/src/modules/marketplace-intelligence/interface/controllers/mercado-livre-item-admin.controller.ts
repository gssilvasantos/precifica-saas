import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
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
import { MercadoLivreItemAdminService } from '../../application/mercado-livre-item-admin.service';
import { UpdateMercadoLivreItemSkuDto } from '../dto/update-mercado-livre-item-sku.dto';

// Administração direta de anúncio do Mercado Livre (24/09/2026, a pedido do
// Gui — ver racional completo em MercadoLivreItemAdminService). Pensado
// primeiro para consumo via kyneti-mcp-server ("um mcp com o mercado livre,
// que fique disponível para todo o claude"), mas os endpoints seguem o
// MESMO guard HTTP normal do resto do Kyneti — o MCP se autentica como um
// usuário comum (a conta de serviço do próprio mcp-server), nunca ganha
// nenhum atalho de permissão.
//
// GET é liberado a qualquer papel com acesso ao módulo Integrações
// (inclusive VIEWER) — só leitura, mesmo risco de qualquer outro GET deste
// módulo. PATCH (escrita real no Mercado Livre) exige ADMIN ou
// PRICING_EDITOR — VIEWER nunca escreve, nem via MCP: a conta de serviço do
// mcp-server precisa ser promovida de VIEWER para PRICING_EDITOR na tela de
// Equipe do próprio Kyneti para este endpoint funcionar (ver mcp-server/README.md).
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.INTEGRATIONS)
@Controller('marketplace-intelligence/mercado-livre/items')
export class MercadoLivreItemAdminController {
  constructor(private readonly items: MercadoLivreItemAdminService) {}

  @Get(':itemId')
  getItem(@CurrentUser() user: AuthenticatedUser, @Param('itemId') itemId: string) {
    return this.items.getItem(user.tenantId, itemId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':itemId/sku')
  updateSku(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateMercadoLivreItemSkuDto,
  ) {
    return this.items.updateItemSku(user.tenantId, itemId, dto.skuCode);
  }
}
