import {
  buildVariantName,
  buildVariantSkuCode,
  canSetParent,
  generateVariantCombinations,
  isValidAttributeDefinitions,
  isValidVariantAttributes,
  isVariant,
} from './product-variant';

describe('isVariant', () => {
  it('false quando parentProductId é null', () => {
    expect(isVariant({ parentProductId: null })).toBe(false);
  });

  it('true quando parentProductId está definido', () => {
    expect(isVariant({ parentProductId: 'parent-1' })).toBe(true);
  });
});

describe('isValidVariantAttributes', () => {
  it('rejeita null/undefined', () => {
    expect(isValidVariantAttributes(null)).toBe(false);
    expect(isValidVariantAttributes(undefined)).toBe(false);
  });

  it('rejeita objeto vazio', () => {
    expect(isValidVariantAttributes({})).toBe(false);
  });

  it('rejeita chave em branco', () => {
    expect(isValidVariantAttributes({ '  ': 'Azul' })).toBe(false);
  });

  it('rejeita valor em branco', () => {
    expect(isValidVariantAttributes({ Cor: '   ' })).toBe(false);
  });

  it('aceita um par chave/valor válido', () => {
    expect(isValidVariantAttributes({ Cor: 'Azul' })).toBe(true);
  });

  it('aceita múltiplos pares', () => {
    expect(isValidVariantAttributes({ Cor: 'Azul', Tamanho: 'P' })).toBe(true);
  });
});

describe('canSetParent', () => {
  const candidateParent = { id: 'parent-1', parentProductId: null };

  it('rejeita auto-referência', () => {
    const check = canSetParent({
      productId: 'prod-1',
      candidateParentId: 'prod-1',
      candidateParent: { id: 'prod-1', parentProductId: null },
      productHasChildren: false,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/si mesmo/);
  });

  it('rejeita quando o pai candidato não existe', () => {
    const check = canSetParent({
      productId: 'prod-1',
      candidateParentId: 'parent-inexistente',
      candidateParent: null,
      productHasChildren: false,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/não encontrado/);
  });

  it('rejeita quando o pai candidato já é ele mesmo uma variação (hierarquia de 1 nível)', () => {
    const check = canSetParent({
      productId: 'prod-1',
      candidateParentId: 'parent-1',
      candidateParent: { id: 'parent-1', parentProductId: 'avo-1' },
      productHasChildren: false,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/um nível/);
  });

  it('rejeita quando o produto que está virando variação já tem filhos', () => {
    const check = canSetParent({
      productId: 'prod-1',
      candidateParentId: 'parent-1',
      candidateParent,
      productHasChildren: true,
    });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/já tem variações/);
  });

  it('aceita quando tudo é válido', () => {
    const check = canSetParent({
      productId: 'prod-1',
      candidateParentId: 'parent-1',
      candidateParent,
      productHasChildren: false,
    });
    expect(check.ok).toBe(true);
  });
});

// Quick Win 5 (benchmark Bling, docs/bling-erp-benchmark-analysis.md, seção
// 1.5) — geração automática de combinações de variação.
describe('isValidAttributeDefinitions', () => {
  it('rejeita null/undefined/vazio', () => {
    expect(isValidAttributeDefinitions(null)).toBe(false);
    expect(isValidAttributeDefinitions(undefined)).toBe(false);
    expect(isValidAttributeDefinitions([])).toBe(false);
  });

  it('rejeita atributo com nome em branco', () => {
    expect(isValidAttributeDefinitions([{ name: '  ', options: ['Azul'] }])).toBe(false);
  });

  it('rejeita atributo sem nenhuma opção', () => {
    expect(isValidAttributeDefinitions([{ name: 'Cor', options: [] }])).toBe(false);
  });

  it('rejeita opção em branco', () => {
    expect(isValidAttributeDefinitions([{ name: 'Cor', options: ['Azul', '  '] }])).toBe(false);
  });

  it('aceita um atributo válido', () => {
    expect(isValidAttributeDefinitions([{ name: 'Cor', options: ['Azul', 'Verde'] }])).toBe(true);
  });

  it('aceita múltiplos atributos válidos', () => {
    expect(
      isValidAttributeDefinitions([
        { name: 'Cor', options: ['Azul', 'Verde'] },
        { name: 'Tamanho', options: ['P', 'M', 'G'] },
      ]),
    ).toBe(true);
  });
});

describe('generateVariantCombinations', () => {
  it('um único atributo gera uma combinação por opção', () => {
    const result = generateVariantCombinations([{ name: 'Cor', options: ['Azul', 'Verde'] }]);
    expect(result).toEqual([{ Cor: 'Azul' }, { Cor: 'Verde' }]);
  });

  it('dois atributos geram o produto cartesiano (2x3 = 6 combinações)', () => {
    const result = generateVariantCombinations([
      { name: 'Cor', options: ['Azul', 'Verde'] },
      { name: 'Tamanho', options: ['P', 'M', 'G'] },
    ]);
    expect(result).toHaveLength(6);
    expect(result).toEqual([
      { Cor: 'Azul', Tamanho: 'P' },
      { Cor: 'Azul', Tamanho: 'M' },
      { Cor: 'Azul', Tamanho: 'G' },
      { Cor: 'Verde', Tamanho: 'P' },
      { Cor: 'Verde', Tamanho: 'M' },
      { Cor: 'Verde', Tamanho: 'G' },
    ]);
  });

  it('três atributos geram o produto cartesiano completo (2x2x2 = 8 combinações)', () => {
    const result = generateVariantCombinations([
      { name: 'Cor', options: ['Azul', 'Verde'] },
      { name: 'Tamanho', options: ['P', 'M'] },
      { name: 'Material', options: ['Algodão', 'Poliéster'] },
    ]);
    expect(result).toHaveLength(8);
    // Todas as combinações são distintas entre si.
    const serialized = result.map((combo) => JSON.stringify(combo));
    expect(new Set(serialized).size).toBe(8);
  });
});

describe('buildVariantSkuCode', () => {
  const definitions = [
    { name: 'Cor', options: ['Azul'] },
    { name: 'Tamanho', options: ['P'] },
  ];

  it('concatena o SKU base com um sufixo normalizado por atributo, na ordem das definições', () => {
    const skuCode = buildVariantSkuCode('CAMISETA-01', { Cor: 'Azul', Tamanho: 'P' }, definitions);
    expect(skuCode).toBe('CAMISETA-01-AZUL-P');
  });

  it('normaliza acento, espaço e caixa', () => {
    const skuCode = buildVariantSkuCode('CAMISETA-01', { Cor: 'Azul Marinho', Tamanho: 'p' }, definitions);
    expect(skuCode).toBe('CAMISETA-01-AZUL-MARINHO-P');
  });
});

describe('buildVariantName', () => {
  it('monta o nome como "nome do pai (valor / valor)", na ordem das definições', () => {
    const definitions = [
      { name: 'Cor', options: ['Azul'] },
      { name: 'Tamanho', options: ['P'] },
    ];
    const name = buildVariantName('Camiseta Básica', { Cor: 'Azul', Tamanho: 'P' }, definitions);
    expect(name).toBe('Camiseta Básica (Azul / P)');
  });
});
