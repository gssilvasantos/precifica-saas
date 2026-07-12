import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, CurrentUser, AuthenticatedUser } from '../../../identity-access/public-api';
import { PricingDecisionService } from '../../application/pricing-decision.service';

// Endpoint de inspeção/teste manual — chama o mesmo caminho que o
// CompetitorSignalListener chama automaticamente ao reagir a um
// BUY_BOX_LOST, mas sob demanda (sem precisar esperar um evento real).
// Útil para validar a regra de margem mínima sem depender de um radar de
// concorrência funcionando de ponta a ponta ainda.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pricing-intelligence/decisions')
export class PricingDecisionController {
  constructor(private readonly decisions: PricingDecisionService) {}

  @Get(':skuCode')
  async getDecision(@CurrentUser() user: AuthenticatedUser, @Param('skuCode') skuCode: string) {
    const decision = await this.decisions.decide(user.tenantId, skuCode);
    if (!decision) {
      throw new NotFoundException(
        `Não há dado suficiente para calcular uma decisão de preço para o SKU ${skuCode} ainda (produto, oportunidade competitiva ou preço vinculado a canal ausentes).`,
      );
    }
    return decision;
  }
}
