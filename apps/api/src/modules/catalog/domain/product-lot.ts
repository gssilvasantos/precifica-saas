// Produtos-Lotes (rastreamento de lote/validade, FEFO) — Projeto
// Estruturante 2, benchmark Bling ERP, 29/07/2026 (ver
// docs/bling-erp-benchmark-analysis.md, seção 1.2, e
// docs/product-lots-architecture.md). Só funções PURAS aqui — nenhuma
// chamada a Prisma/HTTP, mesmo racional de domain/product-structure.ts e
// domain/stock-movement-audit-event.entity.ts. Datas sempre recebidas como
// parâmetro explícito (`now`), nunca `new Date()` interno — testável sem
// relógio real, mesmo padrão de isExpiredForRetention (video-capture.entity.ts).

export type ProductLotStatus = 'ATIVO' | 'INATIVO';

export interface ProductLot {
  id: string;
  tenantId: string;
  skuCode: string;
  lotCode: string;
  dataFabricacao: Date | null;
  dataValidade: Date;
  diasPermitidoVenda: number;
  codigoAgregacao: string | null;
  status: ProductLotStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductLotCreateData {
  tenantId: string;
  skuCode: string;
  lotCode: string;
  dataFabricacao?: Date | null;
  dataValidade: Date;
  diasPermitidoVenda?: number;
  codigoAgregacao?: string | null;
  status?: ProductLotStatus;
}

export interface GateCheck {
  ok: boolean;
  reason?: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Validação de cadastro — lotCode não vazio, dataValidade é uma data real,
// diasPermitidoVenda não é negativo (dias negativos não expressam nenhuma
// regra de negócio válida: "vender depois de vencido" não é o que este
// campo controla).
export function isValidLotData(
  data: Pick<ProductLotCreateData, 'lotCode' | 'dataValidade' | 'diasPermitidoVenda'>,
): GateCheck {
  if (!data.lotCode || data.lotCode.trim().length === 0) {
    return { ok: false, reason: 'Código do lote é obrigatório.' };
  }
  if (!(data.dataValidade instanceof Date) || Number.isNaN(data.dataValidade.getTime())) {
    return { ok: false, reason: 'Data de validade inválida.' };
  }
  if (data.diasPermitidoVenda !== undefined && data.diasPermitidoVenda < 0) {
    return { ok: false, reason: 'diasPermitidoVenda não pode ser negativo.' };
  }
  return { ok: true };
}

export function isLotExpired(lot: Pick<ProductLot, 'dataValidade'>, now: Date): boolean {
  return now.getTime() >= lot.dataValidade.getTime();
}

// Bloqueia a venda diasPermitidoVenda DIAS ANTES do vencimento — ex.:
// diasPermitidoVenda=30, dataValidade=10/08 -> bloqueado a partir de 11/07,
// não só depois de vencido de fato. diasPermitidoVenda=0 (default) só
// bloqueia quando já vencido. status=INATIVO bloqueia sempre, independente
// de data (lote desativado manualmente pelo operador).
export function isLotSellable(
  lot: Pick<ProductLot, 'dataValidade' | 'diasPermitidoVenda' | 'status'>,
  now: Date,
): GateCheck {
  if (lot.status !== 'ATIVO') {
    return { ok: false, reason: 'Lote está INATIVO.' };
  }
  const cutoff = lot.dataValidade.getTime() - lot.diasPermitidoVenda * ONE_DAY_MS;
  if (now.getTime() >= cutoff) {
    return {
      ok: false,
      reason: isLotExpired(lot, now)
        ? 'Lote vencido.'
        : `Lote dentro da janela de bloqueio de venda (${lot.diasPermitidoVenda} dia(s) antes do vencimento).`,
    };
  }
  return { ok: true };
}

// Saldo disponível de UM lote, na forma mínima que a alocação FEFO precisa
// — resolvido pelo chamador (StockLedgerRepository, filtrando por lotCode)
// ANTES de chegar aqui; esta função nunca consulta banco.
export interface LotAvailability {
  lotCode: string;
  dataValidade: Date;
  diasPermitidoVenda: number;
  status: ProductLotStatus;
  availableQuantity: number;
}

export interface LotAllocation {
  lotCode: string;
  quantity: number;
}

export interface FefoSelectionResult {
  allocations: LotAllocation[];
  // false = os lotes vendáveis não tinham saldo suficiente para cobrir toda
  // a quantidade pedida — allocations ainda assim traz o que foi possível
  // alocar (parcial), nunca aloca além do disponível.
  fullyAllocated: boolean;
  shortfall: number;
}

// FEFO (First-Expire-First-Out) — dado o saldo disponível por lote e uma
// quantidade a consumir, aloca sempre do lote que vence PRIMEIRO entre os
// vendáveis (ver isLotSellable), até esgotar a quantidade pedida ou os
// lotes disponíveis. Pura: só SUGERE como distribuir — não decide se a
// alocação resultante é de fato registrada em algum lugar (isso é
// responsabilidade da aplicação, ver docs/product-lots-architecture.md,
// seção 5, para o gap documentado de que esta sugestão ainda não é
// automaticamente aplicada nos fluxos de venda/despacho existentes). Lotes
// não vendáveis (vencidos, bloqueados pela janela, ou INATIVO) e lotes sem
// saldo são ignorados inteiramente, nunca alocados.
export function selectLotsForConsumption(lots: LotAvailability[], quantity: number, now: Date): FefoSelectionResult {
  if (quantity <= 0) {
    return { allocations: [], fullyAllocated: true, shortfall: 0 };
  }

  const sellable = lots
    .filter((lot) => lot.availableQuantity > 0 && isLotSellable(lot, now).ok)
    .sort((a, b) => a.dataValidade.getTime() - b.dataValidade.getTime());

  const allocations: LotAllocation[] = [];
  let remaining = quantity;

  for (const lot of sellable) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableQuantity, remaining);
    if (take > 0) {
      allocations.push({ lotCode: lot.lotCode, quantity: take });
      remaining -= take;
    }
  }

  return { allocations, fullyAllocated: remaining <= 0, shortfall: Math.max(remaining, 0) };
}
