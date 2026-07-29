import { Inject, Injectable } from '@nestjs/common';
import { STOCK_LEDGER_REPOSITORY, StockLedgerRepository } from './ports/stock-ledger-repository.port';
import { PRODUCT_LOT_READER, ProductLotReader } from '../../../shared/contracts/product-lot-reader.port';
import { selectLotsForConsumption, FefoSelectionResult, LotAvailability, ProductLotStatus } from '../../catalog/domain/product-lot';

export interface LotBalanceLine {
  lotCode: string;
  balance: number;
  dataValidade: Date;
  diasPermitidoVenda: number;
  status: ProductLotStatus;
}

// Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP, 29/07/2026,
// ver docs/product-lots-architecture.md) — combina metadado de lote
// (PRODUCT_LOT_READER, exportado pelo Catalog) com saldo de ledger
// (StockLedgerRepository, deste módulo) para responder duas perguntas:
// "qual o saldo de cada lote deste SKU neste depósito" e "se eu precisar
// consumir N unidades agora, de quais lotes eu tiraria" (FEFO). Só LEITURA
// — não escreve ledger nenhum (isso é StockMovementAuditEventService.adjustLot).
@Injectable()
export class LotAvailabilityService {
  constructor(
    @Inject(STOCK_LEDGER_REPOSITORY) private readonly ledger: StockLedgerRepository,
    @Inject(PRODUCT_LOT_READER) private readonly lotReader: ProductLotReader,
  ) {}

  async getLotBalances(tenantId: string, warehouseId: string, skuCode: string): Promise<LotBalanceLine[]> {
    const [balances, lots] = await Promise.all([
      this.ledger.listBalancesByLot(tenantId, warehouseId, skuCode),
      this.lotReader.getLots(tenantId, skuCode),
    ]);
    const lotMetaByCode = new Map(lots.map((lot) => [lot.lotCode, lot]));

    // Só lotes com pelo menos uma linha de ledger neste depósito aparecem
    // aqui (saldo implícito 0 para o resto) — um lote recém-cadastrado sem
    // nenhuma entrada ainda não é um "saldo", é ausência de movimento.
    return balances.map((b) => {
      const meta = lotMetaByCode.get(b.lotCode);
      return {
        lotCode: b.lotCode,
        balance: b.balance,
        dataValidade: meta?.dataValidade ?? new Date(0),
        diasPermitidoVenda: meta?.diasPermitidoVenda ?? 0,
        status: meta?.status ?? 'ATIVO',
      };
    });
  }

  // FEFO (First-Expire-First-Out) — sugestão de quais lotes consumir para
  // cobrir `quantity` unidades deste SKU neste depósito, sem gravar nada.
  // Ver domain/product-lot.ts (catalog), selectLotsForConsumption, e a
  // seção "gaps conhecidos" de docs/product-lots-architecture.md: esta
  // sugestão ainda não é aplicada automaticamente em nenhum fluxo de
  // venda/despacho existente.
  async suggestFefoConsumption(tenantId: string, warehouseId: string, skuCode: string, quantity: number): Promise<FefoSelectionResult> {
    const [balances, lots] = await Promise.all([
      this.ledger.listBalancesByLot(tenantId, warehouseId, skuCode),
      this.lotReader.getLots(tenantId, skuCode),
    ]);
    const balanceByCode = new Map(balances.map((b) => [b.lotCode, b.balance]));

    const availability: LotAvailability[] = lots.map((lot) => ({
      lotCode: lot.lotCode,
      dataValidade: lot.dataValidade,
      diasPermitidoVenda: lot.diasPermitidoVenda,
      status: lot.status,
      availableQuantity: balanceByCode.get(lot.lotCode) ?? 0,
    }));

    return selectLotsForConsumption(availability, quantity, new Date());
  }
}
