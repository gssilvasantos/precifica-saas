// Vendedores + Comissão (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026, docs/sellers-architecture.md). Só funções PURAS aqui —
// nenhuma chamada a Prisma/HTTP, mesmo racional de domain/product-lot.ts e
// domain/production-order.entity.ts.

export interface Vendedor {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  aliquotaComissaoPct: number;
  descontoMaximoPct: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VendedorCreateData {
  tenantId: string;
  name: string;
  email?: string | null;
  aliquotaComissaoPct: number;
  descontoMaximoPct?: number | null;
  isActive?: boolean;
}

export type VendedorUpdateData = Partial<Pick<VendedorCreateData, 'name' | 'email' | 'aliquotaComissaoPct' | 'descontoMaximoPct'>>;

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

// Validação de cadastro — nome obrigatório, alíquota entre 0 e 100
// (inclusive), descontoMaximoPct (quando informado) também entre 0 e 100.
// Nenhuma validação de e-mail além de presença opcional — não é campo de
// autenticação, só contato informativo.
export function isValidVendedorData(
  data: Pick<VendedorCreateData, 'name' | 'aliquotaComissaoPct' | 'descontoMaximoPct'>,
): GateCheck {
  if (!data.name || data.name.trim().length === 0) {
    return { ok: false, reason: 'Nome do vendedor é obrigatório.' };
  }
  if (!Number.isFinite(data.aliquotaComissaoPct) || data.aliquotaComissaoPct < 0 || data.aliquotaComissaoPct > 100) {
    return { ok: false, reason: 'aliquotaComissaoPct deve estar entre 0 e 100.' };
  }
  if (
    data.descontoMaximoPct !== undefined &&
    data.descontoMaximoPct !== null &&
    (!Number.isFinite(data.descontoMaximoPct) || data.descontoMaximoPct < 0 || data.descontoMaximoPct > 100)
  ) {
    return { ok: false, reason: 'descontoMaximoPct deve estar entre 0 e 100.' };
  }
  return { ok: true };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Cálculo puro da comissão — base é o valor sobre o qual a alíquota incide
// (por padrão, OrderItem.totalPrice; ver CommissionService.assignVendedor).
// Arredonda para 2 casas decimais (dinheiro), mesmo racional de round2 em
// financial-intelligence/domain/accounts-payable.entity.ts.
export function computeCommission(base: number, aliquotaPct: number): number {
  if (!Number.isFinite(base) || base < 0) {
    throw new Error('base da comissão deve ser um número não negativo.');
  }
  if (!Number.isFinite(aliquotaPct) || aliquotaPct < 0 || aliquotaPct > 100) {
    throw new Error('aliquotaPct deve estar entre 0 e 100.');
  }
  return round2(base * (aliquotaPct / 100));
}
