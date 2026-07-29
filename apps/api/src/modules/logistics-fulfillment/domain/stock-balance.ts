// Quick Win 3 (benchmark Bling, 29/07/2026, ver
// docs/bling-erp-benchmark-analysis.md, seção 2 — EstoquesSaldosDTO
// saldoFisico/saldoVirtual) — Kyneti já tinha saldoFisico (soma de
// StockLedgerEntry.quantityDelta, ver stock-ledger-repository.port.ts), mas
// nada equivalente a saldoVirtual.
//
// saldoFisico = contagem real presente no depósito. Só muda quando um
// StockMovementAuditEvent vira APROVADO (regra de ouro do ledger, ver
// schema.prisma) — ou seja, um pedido "aguardando conferência" (PENDENTE)
// ainda NÃO foi debitado do físico.
//
// saldoVirtual (aqui chamado de `available`, mesmo padrão em inglês do
// resto do domain/) = o que pode de fato ser prometido a um cliente NOVO
// agora: saldoFisico MENOS o que já está comprometido com pedidos
// aguardando conferência (StockMovementAuditEventItem.expectedQuantity de
// eventos PENDENTE daquele depósito). Sem isso, dois canais podem vender a
// mesma última unidade física antes que a expedição em lote termine de
// conferir o primeiro pedido.
//
// Função pura: só combina dois números já resolvidos por portas
// independentes (StockLedgerRepository e StockMovementAuditEventRepository)
// — nenhuma das duas conhece a outra, mantendo a mesma disciplina de
// Ports & Adapters do resto da plataforma.
export interface StockBalanceLine {
  skuCode: string;
  // saldoFisico — nome do campo mantido (`balance`) para não quebrar quem já
  // consumia GET /logistics-fulfillment/warehouses/:id/balances antes deste
  // quick win (ReplenishmentAdvisorService consome o mesmo formato via
  // StockLedgerRepository.listBalancesByWarehouse diretamente).
  balance: number;
  // Quantidade comprometida com pedidos aguardando conferência (Hub de
  // Provas, conferenceStatus = PENDENTE) neste depósito.
  reserved: number;
  // saldoVirtual — o que pode ser vendido agora sem duplicar promessa.
  available: number;
}

export function mergeStockBalances(
  physical: Array<{ skuCode: string; balance: number }>,
  reserved: Array<{ skuCode: string; reservedQuantity: number }>,
): StockBalanceLine[] {
  const physicalMap = new Map(physical.map((p) => [p.skuCode, p.balance]));
  const reservedMap = new Map(reserved.map((r) => [r.skuCode, r.reservedQuantity]));
  // União dos dois conjuntos de SKU — um SKU pode ter reserva sem ainda ter
  // nenhuma linha de ledger (ex.: primeira venda de um produto recém
  // cadastrado, físico zerado mas já com um pedido aguardando conferência).
  const skuCodes = new Set<string>([...physicalMap.keys(), ...reservedMap.keys()]);

  return Array.from(skuCodes).map((skuCode) => {
    const balance = physicalMap.get(skuCode) ?? 0;
    const reservedQuantity = reservedMap.get(skuCode) ?? 0;
    return {
      skuCode,
      balance,
      reserved: reservedQuantity,
      available: balance - reservedQuantity,
    };
  });
}
