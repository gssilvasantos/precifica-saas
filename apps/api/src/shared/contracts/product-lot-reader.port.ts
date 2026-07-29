// Porta de LEITURA exposta pelo Catalog para o Logistics Fulfillment
// (Produtos-Lotes, Projeto Estruturante 2, benchmark Bling ERP,
// 29/07/2026 — ver ProductLot em prisma/schema.prisma e
// docs/product-lots-architecture.md). Consumida por LotAvailabilityService
// (logistics-fulfillment) para combinar metadado de lote (validade, janela
// de bloqueio) com saldo de ledger na sugestão FEFO — sem depender da
// tabela ProductLot nem da classe concreta ProductLotService, mesma
// disciplina de Ports & Adapters do resto da plataforma (ver
// ProductStructureReader para o par simétrico do Projeto Estruturante 1).
export interface LotMetadata {
  lotCode: string;
  dataValidade: Date;
  diasPermitidoVenda: number;
  status: 'ATIVO' | 'INATIVO';
}

export interface ProductLotReader {
  // Todos os lotes cadastrados deste SKU (qualquer status) — quem decide o
  // que é "vendável" é o domínio consumidor (ver domain/product-lot.ts,
  // isLotSellable), não este método.
  getLots(tenantId: string, skuCode: string): Promise<LotMetadata[]>;
  // Um único lote, para validar que um lotCode informado (ex.: num
  // lançamento manual) de fato existe para este SKU/tenant antes de gravar
  // no ledger.
  findLot(tenantId: string, skuCode: string, lotCode: string): Promise<LotMetadata | null>;
}

export const PRODUCT_LOT_READER = Symbol('PRODUCT_LOT_READER');
