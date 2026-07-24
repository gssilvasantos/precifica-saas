import { parseMapPriceImportCsv } from './map-price-import-row-parser';

// Função pura — sem I/O nenhum. Nunca lança: erros de linha são coletados
// (ver comentário no próprio arquivo) para o usuário ver todos os problemas
// de uma vez, não um por tentativa.
describe('parseMapPriceImportCsv', () => {
  it('parseia linhas válidas com map_price numérico', () => {
    const csv = 'sku_code,map_price\nSKU-001,95.50\nSKU-002,40';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { rowNumber: 1, skuCode: 'SKU-001', mapPrice: 95.5 },
      { rowNumber: 2, skuCode: 'SKU-002', mapPrice: 40 },
    ]);
  });

  it('célula map_price vazia: null (limpar o MAP daquele SKU), não um erro', () => {
    const csv = 'sku_code,map_price\nSKU-001,';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ rowNumber: 1, skuCode: 'SKU-001', mapPrice: null }]);
  });

  it('cabeçalho é case-insensitive e tolera espaços', () => {
    const csv = ' SKU_CODE , MAP_PRICE \nSKU-001,50';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ rowNumber: 1, skuCode: 'SKU-001', mapPrice: 50 }]);
  });

  it('sku_code vazio: erro de linha, não aborta o parsing das demais', () => {
    const csv = 'sku_code,map_price\n,50\nSKU-002,40';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toEqual([{ rowNumber: 1, message: 'sku_code vazio.' }]);
    expect(result.rows).toEqual([{ rowNumber: 2, skuCode: 'SKU-002', mapPrice: 40 }]);
  });

  it('map_price não numérico: erro de linha com a mensagem citando o SKU e o valor recebido', () => {
    const csv = 'sku_code,map_price\nSKU-001,abc';

    const result = parseMapPriceImportCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/SKU-001/);
    expect(result.errors[0].message).toMatch(/abc/);
  });

  it('map_price <= 0: erro de linha (precisa ser maior que zero, ou vazio para limpar)', () => {
    const csv = 'sku_code,map_price\nSKU-001,0\nSKU-002,-10';

    const result = parseMapPriceImportCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
  });

  it('cabeçalho faltando as colunas obrigatórias: erro único, nenhuma linha processada', () => {
    const csv = 'sku,preco\nSKU-001,50';

    const result = parseMapPriceImportCsv(csv);

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/sku_code,map_price/);
  });

  it('arquivo vazio: erro único, nenhuma linha processada', () => {
    const result = parseMapPriceImportCsv('');

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ rowNumber: 0, message: 'Arquivo CSV vazio.' }]);
  });

  it('linhas em branco no meio do arquivo são ignoradas (não contam como linha de dado)', () => {
    const csv = 'sku_code,map_price\nSKU-001,50\n\nSKU-002,60';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { rowNumber: 1, skuCode: 'SKU-001', mapPrice: 50 },
      { rowNumber: 2, skuCode: 'SKU-002', mapPrice: 60 },
    ]);
  });

  it('múltiplos erros são coletados de uma vez, não param no primeiro', () => {
    const csv = 'sku_code,map_price\n,50\nSKU-002,abc\nSKU-003,-5';

    const result = parseMapPriceImportCsv(csv);

    expect(result.errors).toHaveLength(3);
    expect(result.rows).toEqual([]);
  });
});
