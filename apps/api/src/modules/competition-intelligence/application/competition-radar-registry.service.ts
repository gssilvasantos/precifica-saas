import { Inject, Injectable } from '@nestjs/common';
import { CompetitionRadar } from '../../../shared/contracts/competition-radar.contract';

export const COMPETITION_RADARS = Symbol('COMPETITION_RADARS');

// Mesmo padrão do MarketplaceProviderRegistry (marketplace-intelligence):
// todo radar concreto se registra aqui via o token COMPETITION_RADARS no
// module — adicionar uma fonte nova (scraping, PriceAPI, planilha manual)
// nunca altera esta classe nem o orquestrador, só a lista injetada.
@Injectable()
export class CompetitionRadarRegistry {
  constructor(@Inject(COMPETITION_RADARS) private readonly radars: CompetitionRadar[]) {}

  findByCode(code: string): CompetitionRadar | undefined {
    return this.radars.find((r) => r.code === code);
  }

  getAll(): CompetitionRadar[] {
    return this.radars;
  }
}
