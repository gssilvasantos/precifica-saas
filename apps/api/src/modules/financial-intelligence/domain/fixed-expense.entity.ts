export type FixedExpenseRecurrence = 'MONTHLY' | 'WEEKLY' | 'YEARLY' | 'ONE_TIME';

export interface FixedExpense {
  id: string;
  tenantId: string;
  name: string;
  amount: number;
  recurrenceType: FixedExpenseRecurrence;
  dueDay: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FixedExpenseCreateData {
  tenantId: string;
  name: string;
  amount: number;
  recurrenceType: FixedExpenseRecurrence;
  dueDay?: number;
}

export type FixedExpenseUpdateData = Partial<Omit<FixedExpenseCreateData, 'tenantId'>>;
