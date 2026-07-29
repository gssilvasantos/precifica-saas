// Árvore de categoria de produto + atributos por categoria (Fase 4,
// benchmark Tiny ERP, 28/07/2026) — ver prisma/schema.prisma (models
// ProductCategory/CategoryAttribute) e
// docs/marketplace-listing-publish-architecture.md. Funções PURAS, mesma
// disciplina do resto do domínio nesta base (nenhuma chamada a Prisma
// aqui) — espelha product-variant.ts, mas para uma árvore de profundidade
// livre (não travada a 1 nível), porque é assim que o Tiny/Olist modela
// "grupo de categorias + subcategorias".

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

export interface ProductCategory {
  id: string;
  tenantId: string;
  name: string;
  parentCategoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductCategoryCreateData {
  tenantId: string;
  name: string;
  parentCategoryId?: string | null;
}

export type ProductCategoryUpdateData = Partial<Omit<ProductCategoryCreateData, 'tenantId'>>;

export interface CategoryAttribute {
  id: string;
  tenantId: string;
  categoryId: string;
  attributeName: string;
  attributeValue: string;
  extendToChildren: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryAttributeUpsertData {
  tenantId: string;
  categoryId: string;
  attributeName: string;
  attributeValue: string;
  extendToChildren?: boolean;
}

// Diferente de canSetParent (Product, 1 nível só): aqui a árvore pode ter
// qualquer profundidade, então o único jeito de garantir "sem ciclo" é
// verificar se o candidato a pai NÃO é um descendente da própria categoria
// (ancestorIdsOfCandidateParent = toda a cadeia de ancestrais do candidato,
// calculada pela aplicação, que tem acesso ao repositório).
export function canSetCategoryParent(params: {
  categoryId: string;
  candidateParentId: string;
  ancestorIdsOfCandidateParent: string[];
}): GateCheck {
  const { categoryId, candidateParentId, ancestorIdsOfCandidateParent } = params;

  if (categoryId === candidateParentId) {
    return { ok: false, reason: 'Uma categoria não pode ser pai de si mesma.' };
  }
  if (ancestorIdsOfCandidateParent.includes(categoryId)) {
    return {
      ok: false,
      reason: 'Este movimento criaria um ciclo na árvore de categorias (o candidato a pai é descendente desta categoria).',
    };
  }
  return { ok: true };
}

export interface CategoryAttributeDefinition {
  categoryId: string;
  attributeName: string;
  attributeValue: string;
  extendToChildren: boolean;
}

// Um nó da cadeia de categoria, da RAIZ até a categoria alvo (a última
// posição do array é sempre a categoria do produto em si).
export interface CategoryChainNode {
  id: string;
  attributes: CategoryAttributeDefinition[];
}

// Resolve os atributos EFETIVOS de uma categoria, considerando herança —
// espelha "Estender atributos para categorias filhas" do Tiny/Olist:
// - Atributos da PRÓPRIA categoria (último nó da cadeia) sempre se aplicam.
// - Atributos de um ANCESTRAL só se propagam se aquele ancestral marcou
//   extendToChildren = true.
// - Em caso de mesmo attributeName em mais de um nível, o nível MAIS
//   ESPECÍFICO (mais perto da categoria alvo) sempre vence — a função
//   percorre a cadeia da raiz para a folha, então a última atribuição
//   sobrepõe as anteriores.
export function resolveEffectiveAttributes(chain: CategoryChainNode[]): Record<string, string> {
  const result: Record<string, string> = {};
  const leafId = chain.length > 0 ? chain[chain.length - 1].id : null;

  for (const node of chain) {
    const isLeaf = node.id === leafId;
    for (const attr of node.attributes) {
      if (isLeaf || attr.extendToChildren) {
        result[attr.attributeName] = attr.attributeValue;
      }
    }
  }

  return result;
}
