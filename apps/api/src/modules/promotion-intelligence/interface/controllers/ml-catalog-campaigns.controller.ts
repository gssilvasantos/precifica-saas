import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { MlCatalogCampaignService } from '../../application/ml-catalog-campaign.service';
import { MlCatalogItemsQueryDto, MlCatalogPlanQueryDto, MlItemIdParam, MlJoinPromotionDto } from '../dto/ml-catalog-campaign.dto';

// "Buy Box + Campanhas" do Mercado Livre (07/10/2026). Leitura liberada a
// qualquer papel com o módulo Promoções; inscrever em campanha (escrita real
// no ML) exige ADMIN ou PRICING_EDITOR. tenantId vem sempre do token.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.PROMOTIONS)
@Controller('promotion-intelligence/mercado-livre/catalog')
export class MlCatalogCampaignsController {
  constructor(private readonly service: MlCatalogCampaignService) {}

  @Get('items')
  listItems(@CurrentUser() user: AuthenticatedUser, @Query() query: MlCatalogItemsQueryDto) {
    return this.service.listCatalogItems(user.tenantId, { offset: query.offset ?? 0, limit: query.limit ?? 50 });
  }

  @Get('items/:itemId/plan')
  plan(@CurrentUser() user: AuthenticatedUser, @Param() params: MlItemIdParam, @Query() query: MlCatalogPlanQueryDto) {
    return this.service.plan(user.tenantId, params.itemId, query);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('items/:itemId/promotions')
  join(@CurrentUser() user: AuthenticatedUser, @Param() params: MlItemIdParam, @Body() dto: MlJoinPromotionDto) {
    return this.service.join(user.tenantId, params.itemId, dto);
  }
}
