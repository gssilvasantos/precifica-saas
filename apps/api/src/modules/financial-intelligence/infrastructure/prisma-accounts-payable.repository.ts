import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  AccountsPayableListFilters,
  AccountsPayableRepository,
  AccountsPayableSettlement,
} from '../application/ports/accounts-payable-repository.port';
import { AccountsPayable, AccountsPayableCreateData, AccountsPayableUpdateData } from '../domain/accounts-payable.entity';

@Injectable()
export class PrismaAccountsPayableRepository implements AccountsPayableRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: AccountsPayableCreateData): Promise<AccountsPayable> {
    const record = await this.prisma.accountsPayable.create({ data: data as never });
    return this.toDomain(record);
  }

  // $transaction com N creates — Prisma.createMany não retorna as linhas
  // criadas no Postgres, e precisamos do id gerado de cada parcela na
  // resposta ao cliente. Atômico: ou as N parcelas entram juntas, ou nenhuma.
  async createMany(data: AccountsPayableCreateData[]): Promise<AccountsPayable[]> {
    const records = await this.prisma.$transaction(
      data.map((entry) => this.prisma.accountsPayable.create({ data: entry as never })),
    );
    return records.map((r) => this.toDomain(r));
  }

  async findById(tenantId: string, id: string): Promise<AccountsPayable | null> {
    const record = await this.prisma.accountsPayable.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record) : null;
  }

  async findAllByTenant(tenantId: string, filters?: AccountsPayableListFilters): Promise<AccountsPayable[]> {
    const records = await this.prisma.accountsPayable.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status as never } : {}),
        ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      orderBy: { dueDate: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  async update(id: string, data: AccountsPayableUpdateData): Promise<AccountsPayable> {
    const record = await this.prisma.accountsPayable.update({ where: { id }, data: data as never });
    return this.toDomain(record);
  }

  async markPaid(id: string, paidAt: Date, settlement: AccountsPayableSettlement): Promise<AccountsPayable> {
    const record = await this.prisma.accountsPayable.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt,
        paidAmount: settlement.paidAmount,
        interestAmount: settlement.interestAmount,
        discountAmount: settlement.discountAmount,
        feeAmount: settlement.feeAmount,
      } as never,
    });
    return this.toDomain(record);
  }

  async cancel(id: string): Promise<AccountsPayable> {
    const record = await this.prisma.accountsPayable.update({
      where: { id },
      data: { status: 'CANCELLED' } as never,
    });
    return this.toDomain(record);
  }

  // Decimal -> number na borda, mesmo padrão de PrismaReceivableRecordRepository/PrismaFixedExpenseRepository.
  // Quick Win 4 — os 4 campos de baixa são Decimal? no schema: null até a
  // baixa, então cada um precisa do mesmo tratamento null-safe (Number(null)
  // seria 0, errado — teria que ser null mesmo).
  private toDomain(
    record: Record<string, unknown> & {
      amount: { toString(): string };
      paidAmount: { toString(): string } | null;
      interestAmount: { toString(): string } | null;
      discountAmount: { toString(): string } | null;
      feeAmount: { toString(): string } | null;
    },
  ): AccountsPayable {
    return {
      ...record,
      amount: Number(record.amount),
      paidAmount: record.paidAmount !== null ? Number(record.paidAmount) : null,
      interestAmount: record.interestAmount !== null ? Number(record.interestAmount) : null,
      discountAmount: record.discountAmount !== null ? Number(record.discountAmount) : null,
      feeAmount: record.feeAmount !== null ? Number(record.feeAmount) : null,
    } as AccountsPayable;
  }
}
