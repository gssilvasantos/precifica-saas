import { FixedExpense, FixedExpenseCreateData, FixedExpenseUpdateData } from '../../domain/fixed-expense.entity';

export interface FixedExpenseRepository {
  create(data: FixedExpenseCreateData): Promise<FixedExpense>;
  findAllActive(tenantId: string): Promise<FixedExpense[]>;
  findById(tenantId: string, id: string): Promise<FixedExpense | null>;
  update(id: string, data: FixedExpenseUpdateData): Promise<FixedExpense>;
  deactivate(id: string): Promise<FixedExpense>;
}

export const FIXED_EXPENSE_REPOSITORY = Symbol('FIXED_EXPENSE_REPOSITORY');
