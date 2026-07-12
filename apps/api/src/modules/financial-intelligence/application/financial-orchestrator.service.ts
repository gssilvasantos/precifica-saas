import { Inject, Injectable } from '@nestjs/common';
import { ORDER_FINANCIALS_READER } from '../../../shared/contracts/tokens';
import { AppDataMode, OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { buildDreReport, DreReport } from '../domain/dre-report';

// Orquestra a montagem do DRE por canal (Etapa 20) — lê o consolidado
// financeiro do Orders (via a porta ORDER_FINANCIALS_READER, nunca a classe
// concreta OrdersService) e delega o cálculo puro para
// domain/dre-report.ts. "Tempo real": cada chamada recalcula a partir do
// estado atual do banco — sem cache — porque um DRE que mostra número
// desatualizado por causa de um TTL é pior do que um DRE mais lento; mesma
// filosofia de ProductCatalogReader (custo de aquisição nunca fica em
// memória entre chamadas).
@Injectable()
export class FinancialOrchestrator {
  constructor(@Inject(ORDER_FINANCIALS_READER) private readonly orderFinancials: OrderFinancialsReader) {}

  async generateDreReport(tenantId: string, dateFrom?: Date, dateTo?: Date, dataMode?: AppDataMode): Promise<DreReport> {
    const lines = await this.orderFinancials.listForPeriod(tenantId, dateFrom, dateTo, dataMode);
    return buildDreReport(tenantId, lines, dateFrom ?? null, dateTo ?? null);
  }
}
