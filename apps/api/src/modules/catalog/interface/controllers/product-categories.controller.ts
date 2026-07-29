import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { ProductCategoryService } from '../../application/product-category.service';
import { CreateProductCategoryDto } from '../dto/create-product-category.dto';
import { UpdateProductCategoryDto } from '../dto/update-product-category.dto';
import { SetCategoryAttributeDto } from '../dto/set-category-attribute.dto';

// Árvore de categoria + atributos por categoria (Fase 4, benchmark Tiny
// ERP) — mesmo padrão de guards do resto do Catalog: leitura liberada,
// escrita exige ADMIN/PRICING_EDITOR.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoryService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductCategoryDto) {
    return this.categories.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query('parentId') parentId?: string) {
    if (parentId) {
      return this.categories.findChildren(user.tenantId, parentId);
    }
    return this.categories.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.findOne(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateProductCategoryDto) {
    return this.categories.update(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.remove(user.tenantId, id);
  }

  @Get(':id/attributes')
  listAttributes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.categories.listAttributes(user.tenantId, id);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/attributes')
  setAttribute(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetCategoryAttributeDto) {
    return this.categories.setAttribute(user.tenantId, id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id/attributes/:attributeName')
  removeAttribute(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('attributeName') attributeName: string) {
    return this.categories.removeAttribute(user.tenantId, id, attributeName);
  }
}
