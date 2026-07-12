import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FixedExpenseRepository } from '../application/ports/fixed-expense-repository.port';
import { FixedExpense, FixedExpenseCreateData, FixedExpenseUpdateData } from '../domain/fixed-expense.entity';

@Injectable()
export class PrismaFixedExpenseRepository implements FixedExpenseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: FixedExpenseCreateData): Promise<FixedExpense> {
    const record = await this.prisma.fixedExpense.create({ data: data as never });
    return this.toDomain(record);
  }

  async findAllActive(tenantId: string): Promise<FixedExpense[]> {
    const records = await this.prisma.fixedExpense.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async findById(tenantId: string, id: string): Promise<FixedExpense | null> {
    const record = await this.prisma.fixedExpense.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async update(id: string, data: FixedExpenseUpdateData): Promise<FixedExpense> {
    const record = await this.prisma.fixedExpense.update({ where: { id }, data: data as never });
    return this.toDomain(record);
  }

  async deactivate(id: string): Promise<FixedExpense> {
    const record = await this.prisma.fixedExpense.update({ where: { id }, data: { isActive: false } });
    return this.toDomain(record);
  }

  // Decimal -> number na borda, mesmo padrão do resto do Catalog/Packaging.
  private toDomain(record: Record<string, unknown> & { amount: { toString(): string } }): FixedExpense {
    return {
      ...record,
      amount: Number(record.amount),
    } as FixedExpense;
  }
}
