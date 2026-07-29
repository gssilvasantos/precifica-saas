import { mergeStockBalances } from './stock-balance';

describe('mergeStockBalances (benchmark Bling — saldoFisico vs saldoVirtual)', () => {
  it('sem reserva: available igual ao balance (saldoVirtual = saldoFisico)', () => {
    const result = mergeStockBalances([{ skuCode: 'SKU-1', balance: 10 }], []);
    expect(result).toEqual([{ skuCode: 'SKU-1', balance: 10, reserved: 0, available: 10 }]);
  });

  it('com reserva: available = balance - reserved', () => {
    const result = mergeStockBalances(
      [{ skuCode: 'SKU-1', balance: 10 }],
      [{ skuCode: 'SKU-1', reservedQuantity: 3 }],
    );
    expect(result).toEqual([{ skuCode: 'SKU-1', balance: 10, reserved: 3, available: 7 }]);
  });

  it('reserva sem nenhuma linha de ledger ainda: balance 0, available negativo (sinaliza inconsistência a ser investigada)', () => {
    const result = mergeStockBalances([], [{ skuCode: 'SKU-NOVO', reservedQuantity: 5 }]);
    expect(result).toEqual([{ skuCode: 'SKU-NOVO', balance: 0, reserved: 5, available: -5 }]);
  });

  it('SKU com ledger mas sem nenhuma reserva pendente: reserved 0', () => {
    const result = mergeStockBalances(
      [
        { skuCode: 'SKU-1', balance: 10 },
        { skuCode: 'SKU-2', balance: 4 },
      ],
      [{ skuCode: 'SKU-1', reservedQuantity: 2 }],
    );
    expect(result).toEqual(
      expect.arrayContaining([
        { skuCode: 'SKU-1', balance: 10, reserved: 2, available: 8 },
        { skuCode: 'SKU-2', balance: 4, reserved: 0, available: 4 },
      ]),
    );
  });
});
