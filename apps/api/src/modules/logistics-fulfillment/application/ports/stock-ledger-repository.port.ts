// Porta de LEITURA do ledger — a escrita acontece só através de
// StockMovementAuditEventRepository.approveWithLedger (nunca direto), para
// que todo INSERT em StockLedgerEntry passe pela regra de ouro. Esta porta
// existe separada só para consultas de saldo (ex.: tela de estoque,
// inteligência de abastecimento).
export interface StockLedgerRepository {
  getBalance(tenantId: string, warehouseId: string, skuCode: string): Promise<number>;
  // Saldo de todos os SKUs de um depósito — usado pela futura tela de
  // estoque/abastecimento sem precisar de N chamadas a getBalance.
  listBalancesByWarehouse(tenantId: string, warehouseId: string): Promise<Array<{ skuCode: string; balance: number }>>;
  // Produtos-Lotes (Projeto Estruturante 2) — saldo por lote de UM SKU num
  // depósito (soma de quantityDelta agrupada por lotCode, ignorando linhas
  // com lotCode null — SKU sem controle de lote). Consumida por
  // LotAvailabilityService para a sugestão FEFO e a tela de saldo por lote.
  listBalancesByLot(tenantId: string, warehouseId: string, skuCode: string): Promise<Array<{ lotCode: string; balance: number }>>;
}

export const STOCK_LEDGER_REPOSITORY = Symbol('STOCK_LEDGER_REPOSITORY');
