import {
  extractListItems,
  extractListTotal,
  formatOlistV3Date,
  summarizeV3Product,
} from './olist-v3-product-summary';

// Formato conforme o OpenAPI da v3 (GET /produtos/{idProduto}), 12/10/2026.
const PAI_COMPLETO = {
  id: 100,
  sku: 'RM0188',
  tipo: 'V',
  tipoVariacao: 'P',
  ncm: '3304.99.90',
  gtin: '7898600996181',
  origem: 0,
  categoria: { id: 1, nome: 'BASE', caminhoCompleto: 'ROSTO >> BASE' },
  dimensoes: { pesoLiquido: 0.065, pesoBruto: 0.09, largura: 11, altura: 6, comprimento: 16 },
  precos: { preco: 99.9, precoCusto: 31.5 },
  estoque: { quantidade: 12 },
  anexos: [{ id: 1, url: 'https://exemplo.invalid/a.jpg' }, { id: 2, url: 'https://exemplo.invalid/b.jpg' }],
  variacoes: [
    { id: 101, sku: 'RM0188-1', gtin: '789', precos: { preco: 99.9 }, estoque: { quantidade: 3 }, grade: [{ chave: 'Cor', valor: 'A0' }] },
    { id: 102, sku: 'RM0188-2' },
  ],
};

describe('summarizeV3Product', () => {
  it('produto completo: lê custo, estoque, peso, dimensões, NCM, GTIN e conta fotos sem expor URL', () => {
    const resumo = summarizeV3Product(PAI_COMPLETO);

    expect(resumo.campos).toMatchObject({
      precoCusto: 31.5,
      estoqueQuantidade: 12,
      pesoLiquido: 0.065,
      pesoBruto: 0.09,
      largura: 11,
      altura: 6,
      comprimento: 16,
      ncm: '3304.99.90',
      gtin: '7898600996181',
      origem: '0',
      categoria: 'ROSTO >> BASE',
    });
    expect(resumo.fotos).toBe(2);
    expect(resumo.ausentes).toEqual([]);
    expect(JSON.stringify(resumo)).not.toContain('exemplo.invalid');
  });

  it('mostra quais chaves a 1ª variação traz — é como se descobre se dimensões vêm dentro dela', () => {
    const resumo = summarizeV3Product(PAI_COMPLETO);
    expect(resumo.variacoes.total).toBe(2);
    expect(resumo.variacoes.chavesDaPrimeira).toEqual(['estoque', 'gtin', 'grade', 'id', 'precos', 'sku'].sort());
    expect(resumo.variacoes.chavesDaPrimeira).not.toContain('dimensoes');
  });

  it('variação sem dimensões: peso e medidas zerados ou ausentes entram em "ausentes"', () => {
    const resumo = summarizeV3Product({
      id: 101,
      sku: 'RM0188-1',
      tipoVariacao: 'V',
      dimensoes: { pesoLiquido: 0, largura: 11 },
      precos: { precoCusto: 31.5 },
      estoque: { quantidade: 0 },
    });
    expect(resumo.ausentes).toEqual(
      expect.arrayContaining([
        'dimensoes.pesoLiquido',
        'dimensoes.pesoBruto',
        'dimensoes.altura',
        'dimensoes.comprimento',
        'ncm',
        'gtin',
        'anexos',
      ]),
    );
    // estoque 0 é um valor legítimo, não ausência
    expect(resumo.ausentes).not.toContain('estoque.quantidade');
    expect(resumo.ausentes).not.toContain('dimensoes.largura');
  });

  it('payload vazio, nulo ou de tipo errado não lança: tudo vira ausente', () => {
    for (const entrada of [null, undefined, 'texto', 42, [], {}]) {
      const resumo = summarizeV3Product(entrada);
      expect(resumo.id).toBeNull();
      expect(resumo.variacoes.total).toBe(0);
      expect(resumo.ausentes.length).toBeGreaterThan(0);
    }
  });

  it('número com vírgula decimal e texto enorme são normalizados', () => {
    const resumo = summarizeV3Product({ precos: { precoCusto: '31,50' }, ncm: 'x'.repeat(500) });
    expect(resumo.campos.precoCusto).toBe(31.5);
    expect(resumo.campos.ncm?.length).toBe(120);
  });
});

describe('extractListItems / extractListTotal', () => {
  it('lê itens da listagem e ignora o que não tem id', () => {
    const itens = extractListItems({
      itens: [
        { id: 7, sku: 'RM1', tipoVariacao: 'N', dataAlteracao: '2026-10-11 10:00:00' },
        { sku: 'sem-id' },
        null,
      ],
      paginacao: { total: 41 },
    });
    expect(itens).toEqual([{ id: '7', sku: 'RM1', tipoVariacao: 'N', dataAlteracao: '2026-10-11 10:00:00' }]);
  });

  it('resposta malformada vira lista vazia e total nulo', () => {
    expect(extractListItems({ itens: 'x' })).toEqual([]);
    expect(extractListItems(null)).toEqual([]);
    expect(extractListTotal({})).toBeNull();
    expect(extractListTotal({ paginacao: { total: 41 } })).toBe(41);
  });
});

describe('formatOlistV3Date', () => {
  it('formata YYYY-MM-DD HH:mm:ss em UTC, com zero à esquerda', () => {
    expect(formatOlistV3Date(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02 03:04:05');
  });
});
