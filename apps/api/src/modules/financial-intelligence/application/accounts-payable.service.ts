import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS_PAYABLE_REPOSITORY,
  AccountsPayableListFilters,
  AccountsPayableRepository,
} from './ports/accounts-payable-repository.port';
import { SUPPLIER_REPOSITORY, SupplierRepository } from '../../catalog/application/ports/supplier-repository.port';
import {
  AccountsPayable,
  AccountsPayableCreateData,
  AccountsPayableEffectiveStatus,
  AccountsPayableSettlementAdjustments,
  AccountsPayableUpdateData,
  buildInstallmentPlan,
  isValidAmount,
  isValidDescription,
  isValidOccurrence,
  isValidSettlementAdjustments,
  resolveEffectiveStatus,
  resolvePaidAmount,
} from '../domain/accounts-payable.entity';
import { ACCOUNTS_PAYABLE_EVENTS } from '../domain/accounts-payable-events';
import { AccountsPayableWriteRequest, AccountsPayableWriter } from '../../../shared/contracts/accounts-payable-writer.port';

export interface CreateAccountsPayableInput {
  amount: number;
  description: string;
  category?: string | null;
  supplierId?: string | null;
  dueDate: Date;
  occurrence: string;
  notes?: string | null;
  // Obrigatório só quando occurrence === 'PARCELADA' — ver buildInstallmentPlan.
  totalInstallments?: number;
}

export interface AccountsPayableView extends AccountsPayable {
  effectiveStatus: AccountsPayableEffectiveStatus;
}

// Bounded context: financial-intelligence (mesmo módulo de FixedExpense e
// ReceivableRecord — ver comentário em prisma/schema.prisma sobre a decisão
// de não abrir um schema novo para isto). Suppliers pertence ao Catalog
// (schema diferente) — consumido aqui via SUPPLIER_REPOSITORY, mesma
// disciplina de Ports & Adapters já usada em todo o projeto (nunca importar
// SuppliersService concreto).
@Injectable()
export class AccountsPayableService implements AccountsPayableWriter {
  constructor(
    @Inject(ACCOUNTS_PAYABLE_REPOSITORY) private readonly payables: AccountsPayableRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
    private readonly events: EventEmitter2,
  ) {}

  // Porta cross-módulo (AccountsPayableWriter) — consumida pelo Procurement
  // (Ordem de Compra, Fase 1) ao confirmar recebimento. Sempre ÚNICA: quem
  // quiser parcelar usa o endpoint direto deste módulo, não este atalho.
  async createSingle(tenantId: string, request: AccountsPayableWriteRequest): Promise<{ id: string; amount: number }> {
    const [created] = await this.create(tenantId, { ...request, occurrence: 'UNICA' });
    return { id: created.id, amount: created.amount };
  }

  async create(tenantId: string, input: CreateAccountsPayableInput): Promise<AccountsPayableView[]> {
    if (!isValidDescription(input.description)) {
      throw new BadRequestException('description deve ser um texto não vazio de até 200 caracteres.');
    }
    if (!isValidAmount(input.amount)) {
      throw new BadRequestException('amount deve ser um número positivo.');
    }
    if (!isValidOccurrence(input.occurrence)) {
      throw new BadRequestException(`occurrence inválida: "${input.occurrence}".`);
    }
    if (input.supplierId) {
      await this.assertSupplierBelongsToTenant(tenantId, input.supplierId);
    }

    const base = {
      tenantId,
      description: input.description.trim(),
      category: input.category ?? null,
      supplierId: input.supplierId ?? null,
      notes: input.notes ?? null,
    };

    if (input.occurrence === 'PARCELADA') {
      if (!input.totalInstallments || input.totalInstallments < 2) {
        throw new BadRequestException('totalInstallments deve ser um número >= 2 quando occurrence for PARCELADA.');
      }
      const plan = buildInstallmentPlan(input.amount, input.totalInstallments, input.dueDate);
      // Gerado aqui (efeito colateral/id), não dentro da função pura de
      // domínio — ver comentário em buildInstallmentPlan.
      const installmentGroupId = randomUUID();
      const records: AccountsPayableCreateData[] = plan.map((line) => ({
        ...base,
        occurrence: 'PARCELADA' as const,
        amount: line.amount,
        dueDate: line.dueDate,
        installmentGroupId,
        installmentNumber: line.installmentNumber,
        totalInstallments: line.totalInstallments,
      }));
      const created = await this.payables.createMany(records);
      return created.map((p) => this.toView(p));
    }

    const record = await this.payables.create({
      ...base,
      occurrence: input.occurrence,
      amount: input.amount,
      dueDate: input.dueDate,
      installmentGroupId: null,
      installmentNumber: null,
      totalInstallments: null,
    });
    return [this.toView(record)];
  }

  async findOne(tenantId: string, id: string): Promise<AccountsPayableView> {
    const payable = await this.payables.findById(tenantId, id);
    if (!payable) throw new NotFoundException(`Conta a pagar ${id} não encontrada.`);
    return this.toView(payable);
  }

  async list(tenantId: string, filters?: AccountsPayableListFilters): Promise<AccountsPayableView[]> {
    const records = await this.payables.findAllByTenant(tenantId, filters);
    return records.map((p) => this.toView(p));
  }

  async update(tenantId: string, id: string, input: AccountsPayableUpdateData): Promise<AccountsPayableView> {
    const existing = await this.assertBelongsToTenant(tenantId, id);
    if (existing.status !== 'PENDING') {
      throw new ConflictException('Só é possível editar uma conta a pagar pendente.');
    }
    if (input.description !== undefined && !isValidDescription(input.description)) {
      throw new BadRequestException('description deve ser um texto não vazio de até 200 caracteres.');
    }
    if (input.supplierId) {
      await this.assertSupplierBelongsToTenant(tenantId, input.supplierId);
    }
    const updated = await this.payables.update(id, input);
    return this.toView(updated);
  }

  // Único caminho que muda status para PAID — mesmo racional de
  // ReceivableReconciliationService.reconcile: nunca duplicar a mutação em
  // outro método (ex.: dentro de update()).
  //
  // Quick Win 4 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2 — ContasBaixarContaDTO) — adjustments é opcional e aditivo:
  // omitido, o comportamento é idêntico ao de antes (paga o valor de face
  // integral). Informado, juros/tarifa somam e desconto subtrai do valor
  // final baixado — nunca aplicado silenciosamente, os componentes
  // individuais são sempre persistidos junto do total (nunca só o total).
  async markPaid(
    tenantId: string,
    id: string,
    paidAt: Date = new Date(),
    adjustments: AccountsPayableSettlementAdjustments = {},
  ): Promise<AccountsPayableView> {
    const existing = await this.assertBelongsToTenant(tenantId, id);
    if (existing.status === 'PAID') return this.toView(existing); // idempotente
    if (existing.status === 'CANCELLED') {
      throw new ConflictException('Conta a pagar cancelada não pode ser marcada como paga.');
    }
    if (!isValidSettlementAdjustments(adjustments)) {
      throw new BadRequestException('interestAmount/discountAmount/feeAmount devem ser números >= 0.');
    }
    const paidAmount = resolvePaidAmount(existing.amount, adjustments);
    if (paidAmount <= 0) {
      throw new BadRequestException('O valor baixado (após ajustes) deve ser positivo.');
    }
    const updated = await this.payables.markPaid(id, paidAt, {
      paidAmount,
      interestAmount: adjustments.interestAmount ?? null,
      discountAmount: adjustments.discountAmount ?? null,
      feeAmount: adjustments.feeAmount ?? null,
    });
    this.events.emit(ACCOUNTS_PAYABLE_EVENTS.PAID, {
      tenantId,
      accountsPayableId: updated.id,
      amount: updated.amount,
      paidAmount,
      paidAt,
    });
    return this.toView(updated);
  }

  async cancel(tenantId: string, id: string): Promise<AccountsPayableView> {
    const existing = await this.assertBelongsToTenant(tenantId, id);
    if (existing.status === 'PAID') {
      throw new ConflictException('Conta a pagar já paga não pode ser cancelada — reverta manualmente se foi um engano.');
    }
    if (existing.status === 'CANCELLED') return this.toView(existing); // idempotente
    const cancelled = await this.payables.cancel(id);
    return this.toView(cancelled);
  }

  private async assertBelongsToTenant(tenantId: string, id: string): Promise<AccountsPayable> {
    const payable = await this.payables.findById(tenantId, id);
    if (!payable) throw new NotFoundException(`Conta a pagar ${id} não encontrada.`);
    return payable;
  }

  private async assertSupplierBelongsToTenant(tenantId: string, supplierId: string): Promise<void> {
    const supplier = await this.suppliers.findById(tenantId, supplierId);
    if (!supplier) {
      throw new NotFoundException(`Fornecedor ${supplierId} não encontrado.`);
    }
  }

  private toView(payable: AccountsPayable): AccountsPayableView {
    return { ...payable, effectiveStatus: resolveEffectiveStatus(payable, new Date()) };
  }
}
