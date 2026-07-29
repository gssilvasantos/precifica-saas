import { computeCommission, isValidVendedorData } from './vendedor.entity';

describe('vendedor.entity (domain puro)', () => {
  describe('isValidVendedorData', () => {
    it('rejeita nome vazio', () => {
      expect(isValidVendedorData({ name: '', aliquotaComissaoPct: 5 }).ok).toBe(false);
    });

    it('rejeita aliquotaComissaoPct fora de 0-100', () => {
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: -1 }).ok).toBe(false);
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: 101 }).ok).toBe(false);
    });

    it('rejeita descontoMaximoPct fora de 0-100 quando informado', () => {
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: 5, descontoMaximoPct: -1 }).ok).toBe(false);
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: 5, descontoMaximoPct: 101 }).ok).toBe(false);
    });

    it('aceita dados válidos, com ou sem descontoMaximoPct', () => {
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: 5 }).ok).toBe(true);
      expect(isValidVendedorData({ name: 'João', aliquotaComissaoPct: 5, descontoMaximoPct: 10 }).ok).toBe(true);
    });
  });

  describe('computeCommission', () => {
    it('calcula a comissão como percentual da base', () => {
      expect(computeCommission(1000, 5)).toBe(50);
      expect(computeCommission(199.9, 10)).toBe(19.99);
    });

    it('arredonda para 2 casas decimais', () => {
      expect(computeCommission(33.33, 7.5)).toBe(2.5); // 2.49975 -> 2.5
    });

    it('base zero resulta em comissão zero', () => {
      expect(computeCommission(0, 5)).toBe(0);
    });

    it('rejeita base negativa', () => {
      expect(() => computeCommission(-1, 5)).toThrow();
    });

    it('rejeita aliquotaPct fora de 0-100', () => {
      expect(() => computeCommission(100, -1)).toThrow();
      expect(() => computeCommission(100, 101)).toThrow();
    });
  });
});
