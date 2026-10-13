// Agrupa a lista plana de produtos em "pai + variações" para a tabela do
// catálogo. Função pura: só reorganiza, não busca nem calcula nada.
//
// Variação cujo pai NÃO está na lista (pai inativo, filtrado ou excluído)
// aparece como linha normal, no nível de cima — esconder seria perder o produto.
export interface ProductGroup<T> {
  item: T;
  children: T[];
}

export function groupByParent<T extends { product: { id: string; parentProductId: string | null } }>(
  rows: T[],
): ProductGroup<T>[] {
  const ids = new Set(rows.map((r) => r.product.id));
  const childrenByParent = new Map<string, T[]>();
  const top: T[] = [];

  for (const row of rows) {
    const parentId = row.product.parentProductId;
    if (parentId && parentId !== row.product.id && ids.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(row);
      childrenByParent.set(parentId, list);
    } else {
      top.push(row);
    }
  }

  return top.map((item) => ({ item, children: childrenByParent.get(item.product.id) ?? [] }));
}
