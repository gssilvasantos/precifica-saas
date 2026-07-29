// Exportado pelo Financial Intelligence (AccountsPayableService), consumido
// pelo Procurement (Ordem de Compra, Fase 1) ao confirmar recebimento — DTO
// autocontido, mesma disciplina de OrderFinancialsReader/OrderFinancialLine:
// nenhum tipo do domínio interno de financial-intelligence vaza para cá.
export interface AccountsPayableWriteRequest {
  amount: number;
  description: string;
  category?: string | null;
  supplierId?: string | null;
  dueDate: Date;
  notes?: string | null;
}

export interface AccountsPayableWriter {
  // Sempre uma conta ÚNICA (occurrence UNICA) — parcelamento é uma decisão
  // de UI/negócio tomada no cadastro direto de Contas a Pagar, não algo que
  // um consumidor cross-módulo deveria escolher por conta própria. Quem
  // quiser parcelar usa o endpoint direto do financial-intelligence.
  createSingle(tenantId: string, request: AccountsPayableWriteRequest): Promise<{ id: string; amount: number }>;
}

export const ACCOUNTS_PAYABLE_WRITER = Symbol('ACCOUNTS_PAYABLE_WRITER');
