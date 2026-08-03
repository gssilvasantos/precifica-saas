import { Inject, Injectable } from '@nestjs/common';
import { ORDER_FINANCIALS_READER, ADS_SPEND_READER } from '../../../shared/contracts/tokens';
import { AppDataMode, OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { AdsSpendReader } from '../../../shared/contracts/ads-spend-reader.port';
import { FIXED_EXPENSE_REPOSITORY, FixedExpenseRepository } from './ports/fixed-expense-repository.port';
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
  constructor(
    @Inject(ORDER_FINANCIALS_READER) private readonly orderFinancials: OrderFinancialsReader,
    // Publicidade no DRE (01/08/2026) — a feature mais replicada entre os
    // concorrentes pesquisados e a única linha de custo real que o
    // relatório ignorava por completo.
    @Inject(ADS_SPEND_READER) private readonly adsSpend: AdsSpendReader,
    // Despesa fixa é do MESMO bounded context (financial_intelligence), por
    // isso injeta o repositório direto em vez de uma porta compartilhada —
    // porta só existe para atravessar fronteira de módulo.
    @Inject(FIXED_EXPENSE_REPOSITORY) private readonly fixedExpenses: FixedExpenseRepository,
  ) {}

  async generateDreReport(tenantId: string, dateFrom?: Date, dateTo?: Date, dataMode?: AppDataMode): Promise<DreReport> {
    // Em paralelo: as duas fontes são independentes e nenhuma depende do
    // resultado da outra.
    const [lines, adSpend, fixedExpenses, adSpendBySku] = await Promise.all([
      this.orderFinancials.listForPeriod(tenantId, dateFrom, dateTo, dataMode),
      this.adsSpend.sumSpendByChannel(tenantId, dateFrom, dateTo, dataMode),
      // Despesas fixas são cadastro do tenant, não têm modo demo — a mesma
      // lista vale para REAL e DEMO. O rateio para o período acontece
      // dentro de buildDreReport (função pura).
      this.fixedExpenses.findAllActive(tenantId),
      // Gasto por SKU (01/08/2026) — alimenta o custo de Ads por PEDIDO.
      // Lista vazia quando não há captura por item; nesse caso o rateio por
      // pedido fica zerado e só o total por canal aparece.
      this.adsSpend.sumSpendBySku(tenantId, dateFrom, dateTo, dataMode),
    ]);
    return buildDreReport(
      tenantId,
      lines,
      dateFrom ?? null,
      dateTo ?? null,
      new Date(),
      adSpend,
      fixedExpenses,
      adSpendBySku,
    );
  }
}
