import { Inject, Injectable } from '@nestjs/common';
import {
  COMPETITIVE_OPPORTUNITY_REPOSITORY,
  CompetitiveOpportunityRepository,
} from './ports/competitive-opportunity-repository.port';

// Leitura para a UI (todas as oportunidades do tenant) — diferente de
// CompetitiveOpportunityReaderService, que implementa a PORTA consumida por
// outros módulos (findOpportunity, um SKU por vez). Esta aqui é
// interface-only, nunca importada fora deste módulo.
@Injectable()
export class CompetitiveOpportunitiesQueryService {
  constructor(
    @Inject(COMPETITIVE_OPPORTUNITY_REPOSITORY) private readonly opportunities: CompetitiveOpportunityRepository,
  ) {}

  findAllByTenant(tenantId: string) {
    return this.opportunities.findAllByTenant(tenantId);
  }
}
