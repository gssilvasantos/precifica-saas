// Porta exportada pelo Catalog, consumida pelo Logistics Fulfillment
// (LogisticsCostReaderService, Sprint 26) — irmã de
// PackagingLinkedProductsReader, mas para consultas por PROPÓSITO da
// embalagem (purpose), não por SKU. Existe porque a hierarquia de custo
// logístico (kit -> vínculo individual -> default de segurança -> master
// dinâmico) precisa resolver "qual é a embalagem de agrupamento/master/
// segurança do tenant", uma pergunta que ProductCatalogReader não responde
// (ele só sabe falar de UM produto por vez).
export interface PackagingCostSummary {
  id: string;
  costPrice: number;
  purpose: 'STANDARD' | 'GROUPING' | 'MASTER' | 'SAFETY_DEFAULT';
  // Só preenchido quando purpose = MASTER — capacidade máxima (Kg) que essa
  // embalagem aguenta, usada pela seleção dinâmica por cubagem (Prioridade 2).
  maxCapacityKg: number | null;
}

export interface PackagingCostReader {
  findById(tenantId: string, packagingId: string): Promise<PackagingCostSummary | null>;
  // Null = tenant ainda não cadastrou nenhuma embalagem com
  // purpose=SAFETY_DEFAULT — quem chama decide o que fazer (hoje:
  // LogisticsCostReaderService assume custo 0 e loga a lacuna).
  findSafetyDefault(tenantId: string): Promise<PackagingCostSummary | null>;
  // Ordenadas por maxCapacityKg ascendente — quem consome já recebe pronto
  // para "primeira que comporta o total" (Prioridade 2, ainda sem consumidor
  // nesta sprint).
  findAllMaster(tenantId: string): Promise<PackagingCostSummary[]>;
}
