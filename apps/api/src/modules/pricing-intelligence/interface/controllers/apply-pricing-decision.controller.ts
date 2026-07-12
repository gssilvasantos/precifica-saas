import { Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  AuthenticatedUser,
  UserRole,
} from '../../../identity-access/public-api';
import { PricingDecisionService } from '../../application/pricing-decision.service';

// O botão "Aplicar Preço Agora" do front-end. SEMPRE dispara a aplicação
// (via PricingDecisionService.applyDecision), independente de
// Product.autoRepricingEnabled — é o caminho manual para quando a
// automação está desligada (ou para forçar uma aplicação pontual mesmo com
// ela ligada). Só ADMIN aplica preço de verdade num canal — mesma régua de
// "operação sensível" usada em connect/disconnect de ERP e sync-now.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pricing-intelligence')
export class ApplyPricingDecisionController {
  constructor(private readonly decisions: PricingDecisionService) {}

  @Roles(UserRole.ADMIN)
  @Post('apply/:skuCode')
  async apply(@CurrentUser() user: AuthenticatedUser, @Param('skuCode') skuCode: string) {
    const result = await this.decisions.applyDecision(user.tenantId, skuCode);
    if (!result) {
      throw new NotFoundException(
        `Não há dado suficiente para aplicar um preço para o SKU ${skuCode} ainda (produto, oportunidade competitiva ou preço vinculado a canal ausentes).`,
      );
    }
    return result;
  }
}
