import { GenericSettlementParser } from './generic-settlement-parser';

describe('GenericSettlementParser', () => {
  const parser = new GenericSettlementParser('NUVEMSHOP');

  it('parseia JSON válido em RawSettlementEntry[]', () => {
    const json = JSON.stringify([
      { externalReference: 'ORDER-1', amount: 150.5, settledAt: '2026-07-01T00:00:00.000Z' },
      { externalReference: 'ORDER-2', amount: 89.9, settledAt: '2026-07-02T00:00:00.000Z' },
    ]);

    const entries = parser.parse(json, 'JSON');

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      externalReference: 'ORDER-1',
      amount: 150.5,
      settledAt: new Date('2026-07-01T00:00:00.000Z'),
    });
  });

  it('rejeita JSON malformado', () => {
    expect(() => parser.parse('{ isso não é um array', 'JSON')).toThrow(/JSON válido/);
  });

  it('rejeita JSON que não é um array', () => {
    expect(() => parser.parse('{"foo": "bar"}', 'JSON')).toThrow(/precisa ser um array/);
  });

  it('parseia CSV válido em RawSettlementEntry[]', () => {
    const csv = ['external_reference,amount,settled_at', 'ORDER-1,150.5,2026-07-01', 'ORDER-2,89.9,2026-07-02'].join('\n');

    const entries = parser.parse(csv, 'CSV');

    expect(entries).toHaveLength(2);
    expect(entries[0].externalReference).toBe('ORDER-1');
    expect(entries[0].amount).toBe(150.5);
    expect(entries[1].externalReference).toBe('ORDER-2');
  });

  it('rejeita CSV sem as colunas esperadas', () => {
    const csv = ['order_id,total', 'ORDER-1,150.5'].join('\n');

    expect(() => parser.parse(csv, 'CSV')).toThrow(/external_reference,amount,settled_at/);
  });

  it('rejeita entrada com amount inválido', () => {
    const csv = ['external_reference,amount,settled_at', 'ORDER-1,não-é-numero,2026-07-01'].join('\n');

    expect(() => parser.parse(csv, 'CSV')).toThrow(/amount inválido/);
  });

  it('ignora linhas em branco no CSV', () => {
    const csv = ['external_reference,amount,settled_at', '', 'ORDER-1,150.5,2026-07-01', '   '].join('\n');

    const entries = parser.parse(csv, 'CSV');

    expect(entries).toHaveLength(1);
  });
});
