// Ordem de Produção (Projeto Estruturante 1, benchmark Bling ERP,
// 29/07/2026) — ver comentário completo em prisma/schema.prisma, model
// ProductionOrder, e docs/production-architecture.md. Este arquivo contém só
// o TIPO e as funções PURAS que decidem transições de workflow — nenhuma
// chamada a Prisma/HTTP aqui, mesma disciplina de purchase-order.entity.ts/
// stock-movement-audit-event.entity.ts.
export type ProductionOrderStatus = 'RASCUNHO' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

export interface ProductionOrderComponent {
  id: string;
  tenantId: string;
  productionOrderId: string;
  componentSkuCode: string;
  quantityPerUnit: number;
  totalQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductionOrder {
  id: string;
  tenantId: string;
  status: ProductionOrderStatus;
  parentSkuCode: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes: string | null;
  concludedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  components: ProductionOrderComponent[];
}

export interface ProductionOrderComponentCreateData {
  componentSkuCode: string;
  quantityPerUnit: number;
  totalQuantity: number;
}

export interface ProductionOrderCreateData {
  tenantId: string;
  parentSkuCode: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes?: string | null;
  components: ProductionOrderComponentCreateData[];
}

export function isValidQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

// RASCUNHO -> EM_ANDAMENTO — sem nenhum efeito de estoque, só marca "em
// produção" para uso operacional/informativo.
export function canStart(order: Pick<ProductionOrder, 'status'>): GateCheck {
  if (order.status !== 'RASCUNHO') {
    return { ok: false, reason: `Ordem já está ${order.status} — só é possível iniciar a partir de RASCUNHO.` };
  }
  return { ok: true };
}

// RASCUNHO ou EM_ANDAMENTO -> CONCLUIDA — nunca a partir de um estado já
// terminal.
export function canConclude(order: Pick<ProductionOrder, 'status'>): GateCheck {
  if (order.status === 'CONCLUIDA') {
    return { ok: false, reason: 'Ordem já foi concluída — não é possível concluir de novo.' };
  }
  if (order.status === 'CANCELADA') {
    return { ok: false, reason: 'Ordem está cancelada — não é possível concluir.' };
  }
  return { ok: true };
}

// Nunca cancela a partir de CONCLUIDA — estoque já foi movido (componentes
// debitados, produto acabado creditado), uma "cancelada" nesse ponto
// deixaria o sistema inconsistente (mesmo racional de
// PurchaseOrder.canCancel bloqueando quando já ATENDIDO).
export function canCancel(order: Pick<ProductionOrder, 'status'>): GateCheck {
  if (order.status === 'CONCLUIDA') {
    return { ok: false, reason: 'Ordem já foi concluída (CONCLUIDA) — não é possível cancelar depois de concluir.' };
  }
  if (order.status === 'CANCELADA') {
    return { ok: true }; // idempotente — já está no estado alvo
  }
  return { ok: true };
}
