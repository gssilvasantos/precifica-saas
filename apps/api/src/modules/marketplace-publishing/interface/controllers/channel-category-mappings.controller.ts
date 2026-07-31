import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { ChannelCategoryMappingService } from '../../application/channel-category-mapping.service';
import { SetChannelCategoryMappingDto } from '../dto/set-channel-category-mapping.dto';

// Configuração do mapeamento categoria interna <-> categoria do canal (Fase
// 4, benchmark Tiny ERP) — mesmo padrão de guards do resto da base: leitura
// liberada, escrita exige ADMIN/PRICING_EDITOR.
//
// Gate de módulo: CATALOG — passo de configuração de ListingPublicationService.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CATALOG)
@Controller('marketplace-publishing/category-mappings')
export class ChannelCategoryMappingsController {
  constructor(private readonly mappings: ChannelCategoryMappingService) {}

  // Passo 1 do fluxo de configuração — busca por texto livre na API do canal.
  @Get('search')
  search(@Query('marketplaceCode') marketplaceCode: string, @Query('query') query: string) {
    return this.mappings.searchExternalCategories(marketplaceCode, query);
  }

  // Passo 2 — atributos exigidos pela categoria ESCOLHIDA do canal.
  @Get('attributes')
  attributes(@Query('marketplaceCode') marketplaceCode: string, @Query('externalCategoryId') externalCategoryId: string) {
    return this.mappings.getExternalCategoryAttributes(marketplaceCode, externalCategoryId);
  }

  @Get()
  listForCategory(@CurrentUser() user: AuthenticatedUser, @Query('categoryId') categoryId: string) {
    return this.mappings.listMappingsForCategory(user.tenantId, categoryId);
  }

  // Passo 3 — salva o vínculo (upsert).
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  setMapping(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetChannelCategoryMappingDto) {
    return this.mappings.setMapping(user.tenantId, dto.categoryId, dto.marketplaceCode, dto.externalCategoryId, dto.externalCategoryName);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.mappings.removeMapping(user.tenantId, id);
  }
}
