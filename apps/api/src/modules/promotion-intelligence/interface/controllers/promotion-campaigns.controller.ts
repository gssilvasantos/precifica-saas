import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser, AuthenticatedUser, UserRole } from '../../../identity-access/public-api';
import { PromotionCampaignService } from '../../application/promotion-campaign.service';
import { PromotionIntelligenceService } from '../../application/promotion-intelligence.service';
import { CreatePromotionCampaignDto } from '../dto/create-promotion-campaign.dto';
import { EnrollSkuDto } from '../dto/enroll-sku.dto';
import { MarginPreviewQueryDto } from '../dto/margin-preview-query.dto';

// Leitura — qualquer papel autenticado pode consultar campanhas/margem
// (mesmo padrão de outras telas só-leitura); criar campanha e decidir
// adesão exigem ADMIN/PRICING_EDITOR (mesma role que edita preço/margem em
// todo o resto da plataforma).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('promotion-intelligence/campaigns')
export class PromotionCampaignsController {
  constructor(
    private readonly campaigns: PromotionCampaignService,
    private readonly intelligence: PromotionIntelligenceService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePromotionCampaignDto) {
    return this.campaigns.create(user.tenantId, {
      name: dto.name,
      channelCode: dto.channelCode,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
    });
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.campaigns.listByTenant(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.campaigns.getOwned(user.tenantId, id);
  }

  // Pré-visualização do "Semáforo de Margem" — não grava nada. Existe para
  // o usuário simular preços diferentes antes de decidir aderir de verdade.
  @Get(':id/margin-preview')
  async previewMargin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: MarginPreviewQueryDto,
  ) {
    const campaign = await this.campaigns.getOwned(user.tenantId, id);
    return this.intelligence.computeMargin(user.tenantId, query.skuCode, campaign.channelCode, query.promotionalPrice);
  }

  // "Validação Proativa" — bloqueia a gravação (enrollmentStatus BLOCKED)
  // se a margem resultante for negativa, mas SEMPRE responde 201 com o
  // registro (nunca um 4xx pela margem em si): o bloqueio é um dado de
  // negócio para a UI mostrar, não um erro de requisição.
  @Roles(UserRole.ADMIN, UserRole.PRICING_EDITOR)
  @Post(':id/enrollments')
  enroll(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EnrollSkuDto) {
    return this.intelligence.validateEnrollment(user.tenantId, id, dto.skuCode, dto.promotionalPrice);
  }

  @Get(':id/enrollments')
  listEnrollments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.intelligence.listEnrollments(user.tenantId, id);
  }
}
