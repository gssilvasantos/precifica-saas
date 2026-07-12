import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { MarketplaceRulesAdminService } from '../../application/marketplace-rules-admin.service';
import { CreateManualRuleDto } from '../dto/create-manual-rule.dto';

// "Painel Marketplace Intelligence" (governança): revisar pendências,
// aprovar/rejeitar, pin/unpin, cadastro manual (seção 6 do documento de
// arquitetura do módulo).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('marketplace-intelligence/rules')
export class MarketplaceRulesAdminController {
  constructor(private readonly admin: MarketplaceRulesAdminService) {}

  @Get('pending')
  listPending(@Query('marketplaceCode') marketplaceCode?: string) {
    return this.admin.listPending(marketplaceCode);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.admin.approve(id, user.userId);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.admin.reject(id);
  }

  @Roles(UserRole.ADMIN)
  @Put(':id/pin')
  pin(@Param('id') id: string) {
    return this.admin.setPinned(id, true);
  }

  @Roles(UserRole.ADMIN)
  @Put(':id/unpin')
  unpin(@Param('id') id: string) {
    return this.admin.setPinned(id, false);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  createManual(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateManualRuleDto) {
    return this.admin.createManual(dto, user.userId);
  }
}
