import { computeFixedExpensesForPeriod, prorateFixedExpenseForPeriod } from './fixed-expense-proration';
import { FixedExpense } from './fixed-expense.entity';

function buildExpense(overrides: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: 'exp-1',
    tenantId: 'tenant-1',
    name: 'Aluguel do galpão',
    amount: 3000,
    recurrenceType: 'MONTHLY',
    dueDay: 5,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('prorateFixedExpenseForPeriod', () => {
  describe('MENSAL', () => {
    // A propriedade que mais importa: mês fechado devolve o valor EXATO da
    // despesa, não 1,02× nem 0,98×. Um divisor fixo de 30 daria 31/30 =
    // 103% do aluguel em janeiro — erro pequeno que aparece na tela como
    // "lucro que sumiu" sem explicação.
    it('mês de 31 dias fechado: exatamente o valor da despesa', () => {
      const total = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-01-01'), utc('2026-01-31'));
      expect(total).toBeCloseTo(3000, 6);
    });

    it('fevereiro (28 dias) fechado: também exatamente o valor', () => {
      const total = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-02-01'), utc('2026-02-28'));
      expect(total).toBeCloseTo(3000, 6);
    });

    it('meio mês: metade proporcional aos dias', () => {
      // 15 dias de janeiro (31) => 3000 * 15/31 = 1451,61
      const total = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-01-01'), utc('2026-01-15'));
      expect(total).toBeCloseTo((3000 * 15) / 31, 2);
    });

    it('período que cruza meses de tamanhos diferentes usa o divisor de cada mês', () => {
      // 31 dias de janeiro + 28 de fevereiro = 2 meses cheios.
      const total = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-01-01'), utc('2026-02-28'));
      expect(total).toBeCloseTo(6000, 6);
    });

    it('dois meses fechados dão exatamente o dobro', () => {
      const um = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-03-01'), utc('2026-03-31'));
      const dois = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-03-01'), utc('2026-04-30'));
      expect(dois).toBeCloseTo(um * 2, 6);
    });
  });

  describe('SEMANAL', () => {
    it('7 dias fechados: valor cheio', () => {
      const expense = buildExpense({ recurrenceType: 'WEEKLY', amount: 700 });
      const total = prorateFixedExpenseForPeriod(expense, utc('2026-01-01'), utc('2026-01-07'));
      expect(total).toBeCloseTo(700, 6);
    });
  });

  describe('ANUAL', () => {
    it('ano bissexto fechado: valor cheio (366 dias, divisor 366)', () => {
      // 2028 é bissexto.
      const expense = buildExpense({ recurrenceType: 'YEARLY', amount: 12000 });
      const total = prorateFixedExpenseForPeriod(expense, utc('2028-01-01'), utc('2028-12-31'));
      expect(total).toBeCloseTo(12000, 4);
    });
  });

  describe('PONTUAL', () => {
    it('conta integralmente quando a data cai dentro do período — nunca rateada', () => {
      const expense = buildExpense({
        recurrenceType: 'ONE_TIME',
        amount: 5000,
        createdAt: utc('2026-01-10'),
      });
      const total = prorateFixedExpenseForPeriod(expense, utc('2026-01-01'), utc('2026-01-31'));
      expect(total).toBe(5000);
    });

    it('não conta quando a data está fora do período', () => {
      const expense = buildExpense({
        recurrenceType: 'ONE_TIME',
        amount: 5000,
        createdAt: utc('2025-12-10'),
      });
      const total = prorateFixedExpenseForPeriod(expense, utc('2026-01-01'), utc('2026-01-31'));
      expect(total).toBe(0);
    });
  });

  it('despesa inativa não entra em nenhum cenário', () => {
    const total = prorateFixedExpenseForPeriod(
      buildExpense({ isActive: false }),
      utc('2026-01-01'),
      utc('2026-01-31'),
    );
    expect(total).toBe(0);
  });

  it('período invertido devolve zero em vez de número negativo', () => {
    const total = prorateFixedExpenseForPeriod(buildExpense(), utc('2026-01-31'), utc('2026-01-01'));
    expect(total).toBe(0);
  });
});

describe('computeFixedExpensesForPeriod', () => {
  it('soma despesas de recorrências diferentes no mesmo período', () => {
    const total = computeFixedExpensesForPeriod(
      [
        buildExpense({ id: 'a', amount: 3000, recurrenceType: 'MONTHLY' }),
        buildExpense({ id: 'b', amount: 700, recurrenceType: 'WEEKLY' }),
      ],
      utc('2026-01-01'),
      utc('2026-01-31'),
    );

    // 3000 (mês cheio) + 700 * 31/7 = 3000 + 3100
    expect(total).toBeCloseTo(3000 + (700 * 31) / 7, 2);
  });

  it('lista vazia devolve zero', () => {
    expect(computeFixedExpensesForPeriod([], utc('2026-01-01'), utc('2026-01-31'))).toBe(0);
  });
});
