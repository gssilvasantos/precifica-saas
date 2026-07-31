import { Controller, Get, Param, Post, Query, Body, UseGuards } from '@nestjs/common';
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
import { ListingPublicationService } from '../../application/listing-publication.service';
import { PublishListingDto } from '../dto/publish-listing.dto';

// Publicar anúncio novo em marketplace (Fase 4, benchmark Tiny ERP) — Safety
// Lock: `publish` é SEMPRE uma ação manual, disparada por clique explícito
// do usuário (nunca por scheduler/automação) — criar um anúncio público tem
// consequência externa/reputacional real e irreversível de desfazer. Mesmo
// padrão de guards do resto da base: leitura liberada, escrita exige
// ADMIN/PRICING_EDITOR.
//
// Gate de módulo: CATALOG — publica um Product (SKU) num marketplace.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.CATALOG)
@Controller('marketplace-publishing/listings')
export class ListingPublicationsController {
  constructor(private readonly listings: ListingPublicationService) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('publish')
  publish(@CurrentUser() user: AuthenticatedUser, @Body() dto: PublishListingDto) {
    return this.listings.publish(user.tenantId, dto.skuCode, dto.marketplaceCode, {
      price: dto.price,
      availableQuantity: dto.availableQuantity,
      currency: dto.currency,
      overrideAttributes: dto.overrideAttributes,
    });
  }

  @Get()
  listForProduct(@CurrentUser() user: AuthenticatedUser, @Query('productId') productId: string) {
    return this.listings.findAllByProduct(user.tenantId, productId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.listings.findOne(user.tenantId, id);
  }
}
