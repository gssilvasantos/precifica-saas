// BOM real — Produtos-Estrutura (Projeto Estruturante 1, benchmark Bling ERP,
// 29/07/2026, ver docs/bling-erp-benchmark-analysis.md, seção 1.1, e
// docs/production-architecture.md). Funções PURAS que validam e resolvem a
// composição de um produto kit — nenhuma chamada a Prisma/HTTP aqui, mesma
// disciplina de product-variant.ts.

export interface ProductStructureComponentInput {
  componentSkuCode: string;
  quantity: number; // quantidade do componente por UNIDADE do kit — sempre positiva, aceita fração
}

// Regras: ao menos um componente; nenhum componente vazio/quantidade não
// positiva; nenhum componente duplicado (mesmo SKU duas vezes — some numa
// linha só, nunca duas); e o kit nunca pode compor a si mesmo (evita ciclo
// trivial de 1 nível — um ciclo indireto, A compõe B que compõe A, é um gap
// conhecido, deliberadamente fora do escopo desta rodada: BOM multinível não
// existe ainda, ver docs/production-architecture.md).
export function isValidComponents(
  parentSkuCode: string,
  components: ProductStructureComponentInput[],
): boolean {
  if (components.length === 0) return false;
  const seen = new Set<string>();
  for (const component of components) {
    if (!component.componentSkuCode || component.componentSkuCode.trim().length === 0) return false;
    if (component.componentSkuCode === parentSkuCode) return false;
    if (!Number.isFinite(component.quantity) || component.quantity <= 0) return false;
    if (seen.has(component.componentSkuCode)) return false;
    seen.add(component.componentSkuCode);
  }
  return true;
}

export interface ResolvedComponentRequirement {
  componentSkuCode: string;
  quantityPerUnit: number;
  totalQuantity: number;
}

// Congela o requisito de cada componente para uma quantidade a produzir —
// usado por ProductionOrderService.create para montar o snapshot
// (ProductionOrderComponent), mesmo racional de
// buildChecklistFromOrderItems/StockMovementAuditEventItem.expectedQuantity:
// calculado uma vez, no momento da criação, nunca recalculado depois mesmo
// que a BOM mude.
export function resolveComponentRequirements(
  components: Pick<ProductStructureComponentInput, 'componentSkuCode' | 'quantity'>[],
  producedQuantity: number,
): ResolvedComponentRequirement[] {
  return components.map((component) => ({
    componentSkuCode: component.componentSkuCode,
    quantityPerUnit: component.quantity,
    totalQuantity: component.quantity * producedQuantity,
  }));
}
