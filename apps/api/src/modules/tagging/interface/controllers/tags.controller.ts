import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { TaggingService } from '../../application/tagging.service';
import { CreateTagDto } from '../dto/create-tag.dto';

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 4/Fase 0) — marcadores genéricos, polimórficos (Produtos+Pedidos+Contas,
// decisão explícita do usuário). Leitura liberada pra qualquer papel
// autenticado, mesmo racional de WarehousesController; escrita (criar/apagar
// tag, atribuir/desatribuir) exige ADMIN/PRICING_EDITOR.
//
// SEM @RequireModule de propósito (30/07/2026, varredura do Painel de
// Equipe): tag é polimórfica por natureza — a mesma tag pode marcar um
// Product (CATALOG), um Order (ORDERS) ou uma AccountsPayable (FINANCE).
// Prender este controller a um único ModuleCode bloquearia incorretamente
// um colaborador com acesso a, por exemplo, só ORDERS de marcar um pedido.
// Continua exigindo JWT + role (RolesGuard) normalmente — só não passa pelo
// crivo por módulo.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly tagging: TaggingService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tagging.listTags(user.tenantId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTagDto) {
    return this.tagging.createTag(user.tenantId, dto.name, dto.color);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.tagging.deleteTag(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Put(':id/assignments/:entityType/:entityId')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.tagging.assign(user.tenantId, id, entityType, entityId);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id/assignments/:entityType/:entityId')
  unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.tagging.unassign(user.tenantId, id, entityType, entityId);
  }

  // Reverse lookup — "quais tags esta entidade tem" (badge na tela de
  // produto/pedido/conta). Rota própria (não aninhada em :id) porque não
  // depende de nenhuma tag específica.
  @Get('entity/:entityType/:entityId')
  listForEntity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.tagging.listForEntity(user.tenantId, entityType, entityId);
  }
}
