import { InvalidOlistProductError } from './olist-product-normalizer';
import {
  extractV3ParentId,
  extractV3StockItems,
  extractV3VariationRefs,
  normalizeOlistV3Product,
} from './olist-v3-product-normalizer';

const base = {
  id: 77,
  sku: 'RM0100',
  descricao: 'Batom Teste',
  precos: { preco: 59.9, precoCusto: '12,5' },
  estoque: { quantidade: 10 },
  dimensoes: { pesoLiquido: 0.2, pesoBruto: 0.25, largura: 5, altura: 10, comprimento: 6 },
  anexos: [{ url: 'https://x/a.jpg' }, { url: 'https://x/a.jpg' }, { url: 'ftp://nao' }, {}],
  ncm: '3304.10.00',
  gtin: '7890000000001',
  origem: 0,
};

describe('normalizeOlistV3Product', () => {
  it('mapeia os campos da v3 para o formato interno, incluindo estoque', () => {
    const n = normalizeOlistV3Product(base);
    expect(n).toMatchObject({
      externalId: '77',
      skuCode: 'RM0100',
      name: 'Batom Teste',
      costPrice: 12.5,
      erpSalePrice: 59.9,
      stockQuantity: 10,
      weightKg: 0.2,
      lengthCm: 6,
      widthCm: 5,
      heightCm: 10,
      hasCompleteDimensions: true,
      ncm: '3304.10.00',
      gtin: '7890000000001',
      fiscalOriginCode: 0,
      cest: null,
    });
    expect(n.packagingWeightKg).toBeCloseTo(0.05);
    expect(n.photoUrls).toEqual(['https://x/a.jpg']);
  });

  it('campos ausentes viram 0/null sem rejeitar', () => {
    const n = normalizeOlistV3Product({ id: 1, sku: 'A', descricao: 'B' });
    expect(n).toMatchObject({ costPrice: 0, stockQuantity: 0, weightKg: 0, erpSalePrice: null, ncm: null, gtin: null });
    expect(n.hasCompleteDimensions).toBe(false);
  });

  it('peso bruto menor que o líquido não gera embalagem negativa', () => {
    const n = normalizeOlistV3Product({ ...base, dimensoes: { pesoLiquido: 1, pesoBruto: 0.5 } });
    expect(n.packagingWeightKg).toBe(0);
  });

  it.each([
    ['id', { sku: 'A', descricao: 'B' }],
    ['sku', { id: 1, descricao: 'B' }],
    ['descricao', { id: 1, sku: 'A' }],
    ['id (entrada nula)', null],
  ])('rejeita cadastro sem %s', (_label, raw) => {
    expect(() => normalizeOlistV3Product(raw)).toThrow(InvalidOlistProductError);
  });
});

describe('extractV3VariationRefs', () => {
  it('lista id, sku e grade; ignora variação sem id ou sku', () => {
    const refs = extractV3VariationRefs({
      variacoes: [
        { id: 1, sku: 'A-1', grade: [{ chave: 'Cor', valor: 'Rosa' }, { chave: '', valor: 'x' }] },
        { id: 2 },
        { sku: 'A-3' },
      ],
    });
    expect(refs).toEqual([{ externalId: '1', skuCode: 'A-1', variantAttributes: { Cor: 'Rosa' } }]);
  });

  it('sem variacoes devolve lista vazia', () => {
    expect(extractV3VariationRefs({})).toEqual([]);
    expect(extractV3VariationRefs(null)).toEqual([]);
  });
});

describe('extractV3ParentId', () => {
  it('lê produtoPai.id como string', () => {
    expect(extractV3ParentId({ produtoPai: { id: 9 } })).toBe('9');
  });
  it('null quando não há pai', () => {
    expect(extractV3ParentId({})).toBeNull();
  });
});

describe('extractV3StockItems', () => {
  it('extrai idProduto/sku e ignora itens sem idProduto', () => {
    expect(extractV3StockItems({ itens: [{ idProduto: 5, sku: 'X', saldo: 3 }, { sku: 'Y' }] })).toEqual([
      { externalId: '5', sku: 'X' },
    ]);
  });
  it('corpo inesperado devolve vazio', () => {
    expect(extractV3StockItems(undefined)).toEqual([]);
    expect(extractV3StockItems({ itens: 'x' })).toEqual([]);
  });
});
