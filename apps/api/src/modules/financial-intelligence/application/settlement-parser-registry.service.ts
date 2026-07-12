import { Inject, Injectable } from '@nestjs/common';
import { SettlementReportParser } from '../../../shared/contracts/settlement-report-parser.contract';

export const SETTLEMENT_REPORT_PARSERS = Symbol('SETTLEMENT_REPORT_PARSERS');

// Registry multi-provider — mesmo padrão de MarketplaceProviderRegistry/
// CompetitionRadarRegistry: adicionar um marketplace novo é registrar mais
// um SettlementReportParser no token SETTLEMENT_REPORT_PARSERS (module),
// nunca alterar esta classe.
@Injectable()
export class SettlementParserRegistry {
  constructor(@Inject(SETTLEMENT_REPORT_PARSERS) private readonly parsers: SettlementReportParser[]) {}

  findByMarketplaceCode(marketplaceCode: string): SettlementReportParser | undefined {
    return this.parsers.find((p) => p.marketplaceCode === marketplaceCode);
  }
}
