import {
  AccountsPayable,
  AccountsPayableCreateData,
  AccountsPayableStatus,
  AccountsPayableUpdateData,
} from '../../domain/accounts-payable.entity';

// Quick Win 4 (benchmark Bling) — o que de fato é gravado na baixa, já
// resolvido pelo service (paidAmount = resolvePaidAmount(...)). Repositório
// só persiste; nunca recalcula.
export interface AccountsPayableSettlement {
  paidAmount: number;
  interestAmount: number | null;
  discountAmount: number | null;
  feeAmount: number | null;
}

export interface AccountsPayableListFilters {
  status?: AccountsPayableStatus;
  supplierId?: string;
}

export interface AccountsPayableRepository {
  create(data: AccountsPayableCreateData): Promise<AccountsPayable>;
  // Usado só pelo parcelamento (occurrence=PARCELADA) — grava as N linhas de
  // uma vez (mesmo installmentGroupId), nunca uma a uma.
  createMany(data: AccountsPayableCreateData[]): Promise<AccountsPayable[]>;
  findById(tenantId: string, id: string): Promise<AccountsPayable | null>;
  findAllByTenant(tenantId: string, filters?: AccountsPayableListFilters): Promise<AccountsPayable[]>;
  update(id: string, data: AccountsPayableUpdateData): Promise<AccountsPayable>;
  // markPaid/cancel são métodos PRÓPRIOS, separados de update() — mesmo
  // padrão de ReceivableRecordRepository.markPaid/cancel: cada um é o único
  // caminho que muda o campo status para PAID/CANCELLED, respectivamente.
  markPaid(id: string, paidAt: Date, settlement: AccountsPayableSettlement): Promise<AccountsPayable>;
  cancel(id: string): Promise<AccountsPayable>;
}

export const ACCOUNTS_PAYABLE_REPOSITORY = Symbol('ACCOUNTS_PAYABLE_REPOSITORY');
