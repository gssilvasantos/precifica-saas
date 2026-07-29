// Porta de LEITURA exposta pelo Catalog para a BOM (Projeto Estruturante 1,
// benchmark Bling ERP, 29/07/2026 — ver ProductStructureComponent em
// prisma/schema.prisma e docs/production-architecture.md). Consumida pelo
// módulo production (ProductionOrderService) para montar o snapshot de
// componentes de uma ordem de produção, sem depender da tabela
// ProductStructureComponent nem da classe concreta ProductStructureService —
// mesma disciplina de Ports & Adapters do resto da plataforma.
export interface ProductStructureComponentLine {
  componentSkuCode: string;
  quantity: number; // quantidade por UNIDADE do produto pai
}

export interface ProductStructureReader {
  getComponents(tenantId: string, parentSkuCode: string): Promise<ProductStructureComponentLine[]>;
}

export const PRODUCT_STRUCTURE_READER = Symbol('PRODUCT_STRUCTURE_READER');
