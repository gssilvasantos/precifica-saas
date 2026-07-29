import {
  buildInstallmentPlan,
  isValidAmount,
  isValidDescription,
  isValidOccurrence,
  resolveEffectiveStatus,
} from './accounts-payable.entity';

describe('accounts-payable.entity', () => {
  describe('isValidDescription', () => {
    it('aceita texto não vazio até 200 caracteres', () => {
      expect(isValidDescription('Aluguel do galpão')).toBe(true);
      expect(isValidDescription('x'.repeat(200))).toBe(true);
    });

    it('rejeita vazio, só espaço, ou acima de 200 caracteres', () => {
      expect(isValidDescription('')).toBe(false);
      expect(isValidDescription('   ')).toBe(false);
      expect(isValidDescription('x'.repeat(201))).toBe(false);
    });
  });

  describe('isValidAmount', () => {
    it('aceita número positivo finito', () => {
      expect(isValidAmount(0.01)).toBe(true);
      expect(isValidAmount(1500)).toBe(true);
    });

    it('rejeita zero, negativo, NaN ou infinito', () => {
      expect(isValidAmount(0)).toBe(false);
      expect(isValidAmount(-10)).toBe(false);
      expect(isValidAmount(NaN)).toBe(false);
      expect(isValidAmount(Infinity)).toBe(false);
    });
  });

  describe('isValidOccurrence', () => {
    it('aceita os 5 valores válidos', () => {
      for (const value of ['UNICA', 'SEMANAL', 'MENSAL', 'TRIMESTRAL', 'PARCELADA']) {
        expect(isValidOccurrence(value)).toBe(true);
      }
    });

    it('rejeita valor desconhecido', () => {
      expect(isValidOccurrence('QUINZENAL')).toBe(false);
    });
  });

  describe('resolveEffectiveStatus', () => {
    const now = new Date('2026-07-28T12:00:00Z');

    it('PENDING com vencimento futuro continua PENDING', () => {
      const result = resolveEffectiveStatus({ status: 'PENDING', dueDate: new Date('2026-08-01') }, now);
      expect(result).toBe('PENDING');
    });

    it('PENDING com vencimento passado vira OVERDUE (derivado, não gravado)', () => {
      const result = resolveEffectiveStatus({ status: 'PENDING', dueDate: new Date('2026-07-01') }, now);
      expect(result).toBe('OVERDUE');
    });

    it('PAID nunca vira OVERDUE mesmo com dueDate no passado', () => {
      const result = resolveEffectiveStatus({ status: 'PAID', dueDate: new Date('2026-01-01') }, now);
      expect(result).toBe('PAID');
    });

    it('CANCELLED nunca vira OVERDUE mesmo com dueDate no passado', () => {
      const result = resolveEffectiveStatus({ status: 'CANCELLED', dueDate: new Date('2026-01-01') }, now);
      expect(result).toBe('CANCELLED');
    });
  });

  describe('buildInstallmentPlan', () => {
    it('divide 100,00 em 3 parcelas, jogando o resto de centavos na última', () => {
      const plan = buildInstallmentPlan(100, 3, new Date('2026-08-01'));

      expect(plan).toHaveLength(3);
      expect(plan[0].amount).toBe(33.33);
      expect(plan[1].amount).toBe(33.33);
      expect(plan[2].amount).toBe(33.34);

      const sum = plan.reduce((acc, line) => acc + line.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(100);
    });

    it('divide valor exato igualmente, sem sobra', () => {
      const plan = buildInstallmentPlan(300, 3, new Date('2026-08-01'));
      expect(plan.map((l) => l.amount)).toEqual([100, 100, 100]);
    });

    it('numera parcelas 1..N e preenche totalInstallments em todas', () => {
      const plan = buildInstallmentPlan(120, 4, new Date('2026-08-01'));
      expect(plan.map((l) => l.installmentNumber)).toEqual([1, 2, 3, 4]);
      expect(plan.every((l) => l.totalInstallments === 4)).toBe(true);
    });

    it('avança 1 mês por parcela a partir de firstDueDate', () => {
      const plan = buildInstallmentPlan(300, 3, new Date('2026-08-15T00:00:00Z'));
      expect(plan[0].dueDate.getUTCMonth()).toBe(7); // agosto (0-indexed)
      expect(plan[1].dueDate.getUTCMonth()).toBe(8); // setembro
      expect(plan[2].dueDate.getUTCMonth()).toBe(9); // outubro
    });

    it('rejeita totalInstallments menor que 2', () => {
      expect(() => buildInstallmentPlan(100, 1, new Date())).toThrow();
      expect(() => buildInstallmentPlan(100, 0, new Date())).toThrow();
    });

    it('rejeita totalInstallments não inteiro', () => {
      expect(() => buildInstallmentPlan(100, 2.5, new Date())).toThrow();
    });
  });
});
