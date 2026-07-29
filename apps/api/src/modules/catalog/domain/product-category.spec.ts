import { canSetCategoryParent, resolveEffectiveAttributes, CategoryChainNode } from './product-category';

describe('canSetCategoryParent', () => {
  it('rejeita categoria como pai de si mesma', () => {
    const result = canSetCategoryParent({ categoryId: 'cat-1', candidateParentId: 'cat-1', ancestorIdsOfCandidateParent: [] });
    expect(result.ok).toBe(false);
  });

  it('rejeita quando o candidato a pai é descendente da própria categoria (ciclo)', () => {
    const result = canSetCategoryParent({
      categoryId: 'cat-1',
      candidateParentId: 'cat-3',
      ancestorIdsOfCandidateParent: ['cat-2', 'cat-1'],
    });
    expect(result.ok).toBe(false);
  });

  it('aceita quando não há ciclo', () => {
    const result = canSetCategoryParent({
      categoryId: 'cat-3',
      candidateParentId: 'cat-1',
      ancestorIdsOfCandidateParent: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe('resolveEffectiveAttributes', () => {
  it('aplica os atributos da própria categoria (folha) mesmo sem extendToChildren', () => {
    const chain: CategoryChainNode[] = [
      { id: 'leaf', attributes: [{ categoryId: 'leaf', attributeName: 'Cor', attributeValue: 'Azul', extendToChildren: false }] },
    ];
    expect(resolveEffectiveAttributes(chain)).toEqual({ Cor: 'Azul' });
  });

  it('propaga atributo do ancestral quando extendToChildren=true', () => {
    const chain: CategoryChainNode[] = [
      { id: 'root', attributes: [{ categoryId: 'root', attributeName: 'Marca', attributeValue: 'Genérica', extendToChildren: true }] },
      { id: 'leaf', attributes: [] },
    ];
    expect(resolveEffectiveAttributes(chain)).toEqual({ Marca: 'Genérica' });
  });

  it('NÃO propaga atributo do ancestral quando extendToChildren=false', () => {
    const chain: CategoryChainNode[] = [
      { id: 'root', attributes: [{ categoryId: 'root', attributeName: 'Marca', attributeValue: 'Genérica', extendToChildren: false }] },
      { id: 'leaf', attributes: [] },
    ];
    expect(resolveEffectiveAttributes(chain)).toEqual({});
  });

  it('a categoria mais específica sempre vence em caso de colisão de nome', () => {
    const chain: CategoryChainNode[] = [
      { id: 'root', attributes: [{ categoryId: 'root', attributeName: 'Marca', attributeValue: 'Genérica', extendToChildren: true }] },
      { id: 'leaf', attributes: [{ categoryId: 'leaf', attributeName: 'Marca', attributeValue: 'Específica', extendToChildren: false }] },
    ];
    expect(resolveEffectiveAttributes(chain)).toEqual({ Marca: 'Específica' });
  });
});
