import { FixedExpense } from './fixed-expense.entity';

// Rateio de despesa fixa para um período arbitrário (01/08/2026, ver
// docs/revisao-geral-2026-08.md, §3).
//
// PROBLEMA: o DRE aceita qualquer janela de datas, mas despesa fixa tem
// recorrência própria (mensal, semanal, anual). "Quanto do aluguel pertence
// a 12–27 de julho?" não tem resposta óbvia.
//
// SOLUÇÃO: taxa diária, com o divisor vindo do período REAL a que aquele
// dia pertence — cada dia de janeiro contribui `valor/31`, cada dia de
// fevereiro `valor/28`. Isso torna o rateio exato no caso comum (período =
// mês fechado devolve exatamente o valor da despesa, não 1,02× nem 0,98×) e
// proporcional de forma defensável em qualquer outro. Um divisor fixo de 30
// daria 31/30 = 103% do aluguel num mês de 31 dias — erro pequeno, mas que
// aparece como "lucro que sumiu" sem explicação.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysInMonthOf(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function daysInYearOf(date: Date): number {
  const year = date.getUTCFullYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeap ? 366 : 365;
}

// Itera dia a dia porque o divisor muda de mês para mês (e de ano para ano,
// em bissexto). Uma janela de DRE é de dias ou meses, não de séculos — o
// custo é irrelevante e o resultado é exato, em vez de uma aproximação com
// mês médio de 30,44 dias.
export function prorateFixedExpenseForPeriod(expense: FixedExpense, periodFrom: Date, periodTo: Date): number {
  if (!expense.isActive) return 0;
  if (periodTo < periodFrom) return 0;

  // Despesa pontual não é rateada: ou aconteceu dentro da janela, ou não.
  // A data usada é createdAt — é o que o schema tem hoje (FixedExpense não
  // guarda data própria para ONE_TIME; ver comentário do model).
  if (expense.recurrenceType === 'ONE_TIME') {
    const occurredAt = expense.createdAt;
    return occurredAt >= periodFrom && occurredAt <= periodTo ? expense.amount : 0;
  }

  let total = 0;
  const cursor = new Date(
    Date.UTC(periodFrom.getUTCFullYear(), periodFrom.getUTCMonth(), periodFrom.getUTCDate()),
  );
  const end = Date.UTC(periodTo.getUTCFullYear(), periodTo.getUTCMonth(), periodTo.getUTCDate());

  while (cursor.getTime() <= end) {
    switch (expense.recurrenceType) {
      case 'MONTHLY':
        total += expense.amount / daysInMonthOf(cursor);
        break;
      case 'WEEKLY':
        total += expense.amount / 7;
        break;
      case 'YEARLY':
        total += expense.amount / daysInYearOf(cursor);
        break;
    }
    cursor.setTime(cursor.getTime() + MS_PER_DAY);
  }

  return total;
}

export function computeFixedExpensesForPeriod(
  expenses: FixedExpense[],
  periodFrom: Date,
  periodTo: Date,
): number {
  return expenses.reduce((sum, expense) => sum + prorateFixedExpenseForPeriod(expense, periodFrom, periodTo), 0);
}
