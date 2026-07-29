// Porta de LEITURA exposta pelo Sellers (Vendedores + Comissão, Projeto
// Estruturante 3, benchmark Bling ERP, 29/07/2026) — consumida pelo Orders
// (CommissionService.assignVendedor) para validar que um vendedorId
// informado pertence ao tenant e resolver a alíquota de comissão vigente,
// sem que o Orders precise importar a classe concreta VendedorService nem o
// domínio interno de Sellers. Mesmo racional de PRODUCT_STRUCTURE_READER/
// PRODUCT_LOT_READER (Catalog -> outros módulos). DTO autocontido — só os
// campos que um consumidor de atribuição de vendedor precisa.
export interface SellerSummary {
  id: string;
  name: string;
  aliquotaComissaoPct: number;
  isActive: boolean;
}

export interface SellerReader {
  findById(tenantId: string, vendedorId: string): Promise<SellerSummary | null>;
}

export const SELLER_READER = Symbol('SELLER_READER');
