import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { FIXED_EXPENSE_REPOSITORY, FixedExpenseRepository } from './ports/fixed-expense-repository.port';
import { FixedExpenseCreateData, FixedExpenseUpdateData } from '../domain/fixed-expense.entity';

// CRUD de configuração, mesmo padrão de PackagingsService/SuppliersService —
// FixedExpense não tem lógica de domínio própria além de "pertence a este
// tenant". A "inteligência" (rateio, projeção) fica em serviços futuros que
// LEEM esta tabela, não aqui.
@Injectable()
export class FixedExpensesService {
  constructor(@Inject(FIXED_EXPENSE_REPOSITORY) private readonly expenses: FixedExpenseRepository) {}

  create(tenantId: string, input: Omit<FixedExpenseCreateData, 'tenantId'>) {
    return this.expenses.create({ tenantId, ...input });
  }

  findAll(tenantId: string) {
    return this.expenses.findAllActive(tenantId);
  }

  async findOne(tenantId: string, id: string) {
    const expense = await this.expenses.findById(tenantId, id);
    if (!expense) throw new NotFoundException('Despesa fixa não encontrada.');
    return expense;
  }

  async update(tenantId: string, id: string, input: FixedExpenseUpdateData) {
    await this.findOne(tenantId, id);
    return this.expenses.update(id, input);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.expenses.deactivate(id);
  }
}
