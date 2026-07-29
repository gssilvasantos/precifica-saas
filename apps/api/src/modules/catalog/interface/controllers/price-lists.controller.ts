import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { PriceListService } from '../../application/price-list.service';
import { CreatePriceListDto } from '../dto/create-price-list.dto';
import { UpdatePriceListDto } from '../dto/update-price-list.dto';
import { SetPriceListExceptionDto } from '../dto/set-price-list-exception.dto';

// Lista de Preços (Fase 2, benchmark Tiny ERP, seção 1.5). Mesmo padrão de
// guards do resto do módulo: leitura liberada, escrita exige ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('price-lists')
export class PriceListsController {
  constructor(private readonly priceLists: PriceListService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePriceListDto) {
    return this.priceLists.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.priceLists.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.priceLists.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePriceListDto) {
    return this.priceLists.update(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id')
  deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.priceLists.deactivate(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/exceptions')
  setException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetPriceListExceptionDto,
  ) {
    return this.priceLists.setException(user.tenantId, id, dto);
  }

  @Get(':id/exceptions')
  listExceptions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.priceLists.listExceptions(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id/exceptions/:productId')
  removeException(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.priceLists.removeException(user.tenantId, id, productId);
  }

  // Leitura combinada: aplica a lista (+ exceção, se houver) sobre o
  // basePrice informado via query string — ver comentário de
  // PriceListService.resolvePrice sobre por que basePrice é sempre externo.
  @Get(':id/resolve-price/:productId')
  resolvePrice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Query('basePrice') basePrice: string,
  ) {
    return this.priceLists.resolvePrice(user.tenantId, id, productId, Number(basePrice));
  }
}
