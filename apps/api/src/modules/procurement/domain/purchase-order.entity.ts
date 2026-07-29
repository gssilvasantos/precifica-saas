// Ordem de Compra (Fase 1, benchmark Tiny ERP, 28/07/2026) — ver comentário
// completo em prisma/schema.prisma, model PurchaseOrder, e
// docs/procurement-architecture.md. Este arquivo contém só o TIPO e as
// funções PURAS que decidem transições/cálculo — nenhuma chamada a
// Prisma/HTTP aqui, mesma disciplina de stock-movement-audit-event.entity.ts.
export type PurchaseOrderStatus = 'ABERTO' | 'ANDAMENTO' | 'ATENDIDO' | 'CANCELADO';

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

export interface PurchaseOrderItem {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  skuCode: string;
  quantity: number;
  unitCost: number;
  ipi: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrderItemInput {
  skuCode: string;
  quantity: number;
  unitCost: number;
  ipi?: number | null;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  warehouseId: string;
  paymentDueDate: Date;
  notes: string | null;
  invoiceNumber: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: PurchaseOrderItem[];
}

export interface PurchaseOrderCreateData {
  tenantId: string;
  supplierId: string;
  warehouseId: string;
  paymentDueDate: Date;
  notes?: string | null;
  items: PurchaseOrderItemInput[];
}

export function isValidItems(items: PurchaseOrderItemInput[]): boolean {
  if (items.length === 0) return false;
  return items.every(
    (item) =>
      item.skuCode.trim().length > 0 &&
      Number.isInteger(item.quantity) &&
      item.quantity > 0 &&
      Number.isFinite(item.unitCost) &&
      item.unitCost >= 0 &&
      (item.ipi === undefined || item.ipi === null || (Number.isFinite(item.ipi) && item.ipi >= 0)),
  );
}

// Soma quantity*unitCost + ipi (quando informado) de cada item — usado tanto
// para exibição quanto para determinar o valor da AccountsPayable gerada ao
// receber (PurchaseOrderService.receive). Trabalha em centavos (inteiros) na
// soma pra nunca acumular erro de ponto flutuante, mesmo racional de
// buildInstallmentAmounts (accounts-payable.entity.ts).
export function computeTotalAmount(items: Pick<PurchaseOrderItem, 'quantity' | 'unitCost' | 'ipi'>[]): number {
  const totalCents = items.reduce((sum, item) => {
    const lineCents = Math.round(item.quantity * item.unitCost * 100);
    const ipiCents = item.ipi ? Math.round(item.ipi * 100) : 0;
    return sum + lineCents + ipiCents;
  }, 0);
  return totalCents / 100;
}

// ABERTO -> ANDAMENTO: só a partir do estado inicial, nunca de um estado
// terminal (ATENDIDO/CANCELADO) nem repetido a partir de ANDAMENTO.
export function canAdvance(order: Pick<PurchaseOrder, 'status'>): GateCheck {
  if (order.status !== 'ABERTO') {
    return { ok: false, reason: `Ordem já está ${order.status} — só é possível avançar a partir de ABERTO.` };
  }
  return { ok: true };
}

// ABERTO ou ANDAMENTO -> ATENDIDO (via receive) — nunca a partir de um
// estado já terminal.
export function canReceive(order: Pick<PurchaseOrder, 'status'>): GateCheck {
  if (order.status === 'ATENDIDO') {
    return { ok: false, reason: 'Ordem já foi recebida — não é possível receber de novo.' };
  }
  if (order.status === 'CANCELADO') {
    return { ok: false, reason: 'Ordem está cancelada — não é possível receber.' };
  }
  return { ok: true };
}

// Nunca cancela a partir de ATENDIDO — estoque e conta a pagar já foram
// gerados, uma "cancelada" nesse ponto deixaria o sistema inconsistente
// (mesmo racional de AccountsPayableService.cancel bloqueando quando já PAID).
export function canCancel(order: Pick<PurchaseOrder, 'status'>): GateCheck {
  if (order.status === 'ATENDIDO') {
    return { ok: false, reason: 'Ordem já foi recebida (ATENDIDO) — não é possível cancelar depois de receber.' };
  }
  if (order.status === 'CANCELADO') {
    return { ok: true }; // idempotente — já está no estado alvo
  }
  return { ok: true };
}
