import { Inject, Injectable } from '@nestjs/common';
import { ORDER_FINANCIALS_READER } from '../../../shared/contracts/tokens';
import { OrderFinancialsReader } from '../../../shared/contracts/order-financials-reader.port';
import { STOCK_LEDGER_REPOSITORY, StockLedgerRepository } from './ports/stock-ledger-repository.port';
import { WarehouseService } from './warehouse.service';
import { AbcClass, classifyAbc, computeReplenishmentSuggestion, ReplenishmentStatus } from '../domain/replenishment-advisor.entity';

// Janela de giro confirmada com o usuário ao pedir este painel: 30 dias de
// histórico de venda. O LEAD TIME não é mais uma constante — é
// configurável por depósito (Sprint 25, Warehouse.leadTimeDays), lido do CD
// Full de destino em cada chamada, nunca fixo no código. Ver
// docs/logistics-fulfillment-architecture.md, seção 7.
const WINDOW_DAYS = 30;

// Status em que uma ruptura já está acontecendo ou é iminente — usado só
// pra ordenar a tabela (mais urgente primeiro), nunca pra decisão.
const STATUS_SEVERITY: Record<ReplenishmentStatus, number> = { CRITICO: 0, ATENCAO: 1, OK: 2, SEM_GIRO: 3 };

export interface ReplenishmentRow {
  skuCode: string;
  channelCode: string;
  abcClass: AbcClass;
  giroDiario: number;
  saldoFull: number;
  saldoFisico: number;
  coberturaDiasFull: number | null;
  sugestaoEnvio: number;
  status: ReplenishmentStatus;
  physicalShortfall: boolean;
  // Lead time efetivamente usado no cálculo desta linha (do CD Full de
  // destino) — exposto para transparência na UI: se o usuário reconfigurar
  // o valor, quer ver que a tabela reagiu, não confiar às cegas.
  leadTimeDaysUsed: number;
}

// Monta o "painel de comando" de abastecimento pedido pelo usuário: uma
// linha por SKU vendido (ou com saldo) no canal, cruzando giro real de
// venda (Orders, via ORDER_FINANCIALS_READER — mesma porta que já alimenta
// o DRE, Etapa 20) com os saldos do ledger de estoque (Hub de Provas,
// Sprint 24). Nunca escreve nada — é 100% leitura/cálculo.
@Injectable()
export class ReplenishmentAdvisorService {
  constructor(
    private readonly warehouses: WarehouseService,
    @Inject(STOCK_LEDGER_REPOSITORY) private readonly ledger: StockLedgerRepository,
    @Inject(ORDER_FINANCIALS_READER) private readonly orderFinancials: OrderFinancialsReader,
  ) {}

  async getReplenishmentTable(tenantId: string, channelCode: string): Promise<ReplenishmentRow[]> {
    const since = new Date();
    since.setDate(since.getDate() - WINDOW_DAYS);

    // dataMode ausente = 'REAL' (Audit Mode) — o painel de abastecimento
    // nunca sugere reposição baseada em pedido de demonstração.
    const orderLines = await this.orderFinancials.listForPeriod(tenantId, since, undefined);

    const unitsSoldBySku = new Map<string, number>();
    for (const line of orderLines) {
      // Mesmo racional de reconhecimento de receita do DRE
      // (dre-report.ts): pedido CANCELADO não é giro real, não conta.
      if (line.channelCode !== channelCode || line.status === 'CANCELADO') continue;
      for (const item of line.items) {
        if (!item.skuCode) continue; // item sem SKU resolvido no catálogo — não dá pra sugerir reposição de algo que não identificamos
        unitsSoldBySku.set(item.skuCode, (unitsSoldBySku.get(item.skuCode) ?? 0) + item.quantity);
      }
    }

    const [physical, fullWarehouse] = await Promise.all([
      this.warehouses.ensurePhysicalWarehouse(tenantId),
      this.warehouses.ensureFullWarehouse(tenantId, channelCode),
    ]);

    const [fullBalances, physicalBalances] = await Promise.all([
      this.ledger.listBalancesByWarehouse(tenantId, fullWarehouse.id),
      this.ledger.listBalancesByWarehouse(tenantId, physical.id),
    ]);
    const fullBalanceBySku = new Map(fullBalances.map((b) => [b.skuCode, b.balance]));
    const physicalBalanceBySku = new Map(physicalBalances.map((b) => [b.skuCode, b.balance]));

    // União de todos os SKUs relevantes: os que venderam no canal, os que
    // têm saldo no Full e os que têm saldo no físico — um SKU parado
    // (saldo no Full, zero venda recente) precisa aparecer como SEM_GIRO,
    // não sumir da tabela.
    const allSkus = new Set<string>([...unitsSoldBySku.keys(), ...fullBalanceBySku.keys(), ...physicalBalanceBySku.keys()]);

    const abcBySku = classifyAbc(
      [...allSkus].map((skuCode) => ({ skuCode, unitsSoldInWindow: unitsSoldBySku.get(skuCode) ?? 0 })),
    );

    const rows: ReplenishmentRow[] = [...allSkus].map((skuCode) => {
      const unitsSold = unitsSoldBySku.get(skuCode) ?? 0;
      const giroDiario = unitsSold / WINDOW_DAYS;
      const saldoFull = fullBalanceBySku.get(skuCode) ?? 0;
      const saldoFisico = physicalBalanceBySku.get(skuCode) ?? 0;
      const abcClass = abcBySku.get(skuCode) ?? 'C';

      const suggestion = computeReplenishmentSuggestion({
        giroDiario,
        saldoFull,
        saldoFisico,
        // Lead time do CD Full de destino — configurado pelo usuário via
        // PATCH /logistics-fulfillment/warehouses/:id/lead-time, nunca uma
        // constante. Cada canal pode ter uma performance logística diferente.
        leadTimeDays: fullWarehouse.leadTimeDays,
        abcClass,
      });

      return {
        skuCode,
        channelCode,
        abcClass,
        giroDiario,
        saldoFull,
        saldoFisico,
        ...suggestion,
        leadTimeDaysUsed: fullWarehouse.leadTimeDays,
      };
    });

    // Mais urgente primeiro (CRITICO > ATENCAO > OK > SEM_GIRO); dentro do
    // mesmo status, maior giro primeiro — é o "painel de decisão rápida"
    // pedido: o que precisa de atenção agora fica no topo.
    return rows.sort((a, b) => STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status] || b.giroDiario - a.giroDiario);
  }
}
