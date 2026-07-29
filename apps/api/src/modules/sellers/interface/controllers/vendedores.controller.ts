import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { VendedorService } from '../../application/vendedor.service';
import { CreateVendedorDto } from '../dto/create-vendedor.dto';
import { UpdateVendedorDto } from '../dto/update-vendedor.dto';
import { SetVendedorActiveDto } from '../dto/set-vendedor-active.dto';

// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026, docs/sellers-architecture.md) — cadastro do vendedor em si
// (nome, alíquota de comissão, desconto máximo). Atribuição a um item de
// pedido, relatório de comissão e geração de conta a pagar moram no Orders
// (ver orders/interface/controllers/orders.controller.ts) — este
// controller nunca conhece OrderItem.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sellers/vendedores')
export class VendedoresController {
  constructor(private readonly vendedores: VendedorService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVendedorDto) {
    return this.vendedores.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.vendedores.list(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.vendedores.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateVendedorDto) {
    return this.vendedores.update(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id/active')
  setActive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetVendedorActiveDto) {
    return this.vendedores.setActive(user.tenantId, id, dto.isActive);
  }
}
