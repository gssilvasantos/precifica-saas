import { canPublish, PublishableProduct } from './listing-publication.entity';

function buildProduct(overrides: Partial<PublishableProduct> = {}): PublishableProduct {
  return {
    name: 'Produto X',
    photoUrls: ['https://cdn.kyneti.com/x.jpg'],
    weightKg: 0.5,
    categoryId: 'cat-1',
    ...overrides,
  };
}

describe('canPublish', () => {
  const mapping = { externalCategoryId: 'MLB1234', externalCategoryName: 'Camisetas' };

  it('aceita quando tudo está presente e nenhum atributo obrigatório falta', () => {
    const result = canPublish({
      product: buildProduct(),
      mapping,
      effectiveAttributes: { Cor: 'Azul' },
      overrideAttributes: {},
      requiredAttributes: [{ name: 'Cor', required: true }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejeita produto sem nome', () => {
    const result = canPublish({
      product: buildProduct({ name: '' }),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita produto sem foto', () => {
    const result = canPublish({
      product: buildProduct({ photoUrls: [] }),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita produto sem peso', () => {
    const result = canPublish({
      product: buildProduct({ weightKg: 0 }),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita produto sem categoria', () => {
    const result = canPublish({
      product: buildProduct({ categoryId: null }),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita quando não há mapeamento de categoria para o canal', () => {
    const result = canPublish({
      product: buildProduct(),
      mapping: null,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [],
    });
    expect(result.ok).toBe(false);
  });

  it('rejeita quando falta atributo obrigatório do canal', () => {
    const result = canPublish({
      product: buildProduct(),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [{ name: 'Voltagem', required: true }],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Voltagem');
  });

  it('override informado na publicação cobre um atributo obrigatório que a categoria não tinha default', () => {
    const result = canPublish({
      product: buildProduct(),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: { Voltagem: '220V' },
      requiredAttributes: [{ name: 'Voltagem', required: true }],
    });
    expect(result.ok).toBe(true);
  });

  it('atributo não-obrigatório ausente não bloqueia a publicação', () => {
    const result = canPublish({
      product: buildProduct(),
      mapping,
      effectiveAttributes: {},
      overrideAttributes: {},
      requiredAttributes: [{ name: 'Modelo', required: false }],
    });
    expect(result.ok).toBe(true);
  });
});
