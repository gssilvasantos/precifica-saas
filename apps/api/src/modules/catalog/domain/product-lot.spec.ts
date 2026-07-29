import {
  isLotExpired,
  isLotSellable,
  isValidLotData,
  selectLotsForConsumption,
  LotAvailability,
} from './product-lot';

const DAY = 24 * 60 * 60 * 1000;

describe('product-lot (domain puro)', () => {
  describe('isValidLotData', () => {
    it('rejeita lotCode vazio', () => {
      expect(isValidLotData({ lotCode: '', dataValidade: new Date(), diasPermitidoVenda: 0 }).ok).toBe(false);
    });

    it('rejeita dataValidade inválida', () => {
      expect(isValidLotData({ lotCode: 'L1', dataValidade: new Date('not-a-date'), diasPermitidoVenda: 0 }).ok).toBe(false);
    });

    it('rejeita diasPermitidoVenda negativo', () => {
      expect(isValidLotData({ lotCode: 'L1', dataValidade: new Date(), diasPermitidoVenda: -1 }).ok).toBe(false);
    });

    it('aceita dados válidos', () => {
      expect(isValidLotData({ lotCode: 'L1', dataValidade: new Date(), diasPermitidoVenda: 0 }).ok).toBe(true);
    });
  });

  describe('isLotExpired', () => {
    it('true quando now >= dataValidade', () => {
      const dataValidade = new Date('2026-08-01T00:00:00Z');
      expect(isLotExpired({ dataValidade }, new Date('2026-08-01T00:00:00Z'))).toBe(true);
      expect(isLotExpired({ dataValidade }, new Date('2026-08-02T00:00:00Z'))).toBe(true);
    });

    it('false antes do vencimento', () => {
      const dataValidade = new Date('2026-08-01T00:00:00Z');
      expect(isLotExpired({ dataValidade }, new Date('2026-07-31T00:00:00Z'))).toBe(false);
    });
  });

  describe('isLotSellable', () => {
    it('rejeita lote INATIVO independente de data', () => {
      const lot = { dataValidade: new Date(Date.now() + 100 * DAY), diasPermitidoVenda: 0, status: 'INATIVO' as const };
      expect(isLotSellable(lot, new Date()).ok).toBe(false);
    });

    it('rejeita lote já vencido', () => {
      const lot = { dataValidade: new Date('2026-01-01'), diasPermitidoVenda: 0, status: 'ATIVO' as const };
      expect(isLotSellable(lot, new Date('2026-02-01')).ok).toBe(false);
    });

    it('rejeita dentro da janela de bloqueio (diasPermitidoVenda) mesmo sem estar vencido', () => {
      const dataValidade = new Date('2026-08-10T00:00:00Z');
      const lot = { dataValidade, diasPermitidoVenda: 30, status: 'ATIVO' as const };
      // 15 dias antes do vencimento — dentro da janela de 30 dias de bloqueio.
      const now = new Date(dataValidade.getTime() - 15 * DAY);
      const check = isLotSellable(lot, now);
      expect(check.ok).toBe(false);
      expect(check.reason).toContain('janela de bloqueio');
    });

    it('aceita fora da janela de bloqueio', () => {
      const dataValidade = new Date('2026-08-10T00:00:00Z');
      const lot = { dataValidade, diasPermitidoVenda: 30, status: 'ATIVO' as const };
      const now = new Date(dataValidade.getTime() - 40 * DAY);
      expect(isLotSellable(lot, now).ok).toBe(true);
    });
  });

  describe('selectLotsForConsumption (FEFO)', () => {
    const now = new Date('2026-07-29T00:00:00Z');

    it('quantidade <= 0 não aloca nada', () => {
      const result = selectLotsForConsumption([], 0, now);
      expect(result).toEqual({ allocations: [], fullyAllocated: true, shortfall: 0 });
    });

    it('aloca do lote que vence primeiro entre os vendáveis', () => {
      const lots: LotAvailability[] = [
        { lotCode: 'B', dataValidade: new Date('2026-10-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 50 },
        { lotCode: 'A', dataValidade: new Date('2026-09-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 50 },
      ];
      const result = selectLotsForConsumption(lots, 10, now);
      expect(result.allocations).toEqual([{ lotCode: 'A', quantity: 10 }]);
      expect(result.fullyAllocated).toBe(true);
      expect(result.shortfall).toBe(0);
    });

    it('esgota um lote e continua no próximo por ordem de vencimento (split)', () => {
      const lots: LotAvailability[] = [
        { lotCode: 'A', dataValidade: new Date('2026-09-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 5 },
        { lotCode: 'B', dataValidade: new Date('2026-10-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 20 },
      ];
      const result = selectLotsForConsumption(lots, 12, now);
      expect(result.allocations).toEqual([
        { lotCode: 'A', quantity: 5 },
        { lotCode: 'B', quantity: 7 },
      ]);
      expect(result.fullyAllocated).toBe(true);
    });

    it('ignora lote vencido/bloqueado/inativo e sinaliza saldo insuficiente quando faltar', () => {
      const lots: LotAvailability[] = [
        { lotCode: 'VENCIDO', dataValidade: new Date('2026-01-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 100 },
        { lotCode: 'INATIVO', dataValidade: new Date('2026-12-01'), diasPermitidoVenda: 0, status: 'INATIVO', availableQuantity: 100 },
        { lotCode: 'OK', dataValidade: new Date('2026-09-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 3 },
      ];
      const result = selectLotsForConsumption(lots, 10, now);
      expect(result.allocations).toEqual([{ lotCode: 'OK', quantity: 3 }]);
      expect(result.fullyAllocated).toBe(false);
      expect(result.shortfall).toBe(7);
    });

    it('nunca aloca além do disponível de um lote', () => {
      const lots: LotAvailability[] = [
        { lotCode: 'A', dataValidade: new Date('2026-09-01'), diasPermitidoVenda: 0, status: 'ATIVO', availableQuantity: 0 },
      ];
      const result = selectLotsForConsumption(lots, 5, now);
      expect(result.allocations).toEqual([]);
      expect(result.shortfall).toBe(5);
    });
  });
});
