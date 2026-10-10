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
import { MlCatalogListingCreationService } from '../../application/ml-catalog-listing-creation.service';
import { MlCatalogBatchQueryDto, MlCatalogCreationOptionsDto, MlCatalogItemsQueryDto, MlItemIdParam } from '../dto/ml-catalog-campaign.dto';

// Criar anúncio de catálogo pelo EAN (09/10/2026). Leitura (lista e plano) com
// o módulo Promoções; criação (escrita real no ML, atrás de flag) exige ADMIN
// ou PRICING_EDITOR. tenantId vem sempre do token.
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequireModule(ModuleCode.PROMOTIONS)
@Controller('promotion-intelligence/mercado-livre/catalog-creation')
export class MlCatalogListingCreationController {
  constructor(private readonly service: MlCatalogListingCreationService) {}

  @Get('traditional-items')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: MlCatalogItemsQueryDto) {
    return this.service.listTraditionalWithoutCatalog(user.tenantId, { offset: query.offset ?? 0, limit: query.limit ?? 50 });
  }

  @Get('plan-batch')
  planBatch(@CurrentUser() user: AuthenticatedUser, @Query() query: MlCatalogBatchQueryDto) {
    return this.service.planBatch(
      user.tenantId,
      { offset: query.offset ?? 0, limit: query.limit ?? 3 },
      { targetMarginPct: query.targetMarginPct, taxRatePct: query.taxRatePct },
    );
  }

  @Get('items/:itemId/plan')
  plan(@CurrentUser() user: AuthenticatedUser, @Param() params: MlItemIdParam, @Query() query: MlCatalogCreationOptionsDto) {
    return this.service.plan(user.tenantId, params.itemId, query);
  }

  @Get('items/:itemId/variations/plan')
  planVariations(@CurrentUser() user: AuthenticatedUser, @Param() params: MlItemIdParam, @Query() query: MlCatalogCreationOptionsDto) {
    return this.service.planVariations(user.tenantId, params.itemId, query);
  }

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post('items/:itemId/create')
  create(@CurrentUser() user: AuthenticatedUser, @Param() params: MlItemIdParam, @Body() dto: MlCatalogCreationOptionsDto) {
    return this.service.create(user.tenantId, params.itemId, dto);
  }
}
