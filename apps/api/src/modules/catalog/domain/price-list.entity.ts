// Lista de Preços (Fase 2, benchmark Tiny ERP, 28/07/2026) — ver
// docs/tiny-erp-benchmark-analysis.md, seção 1.5, e
// docs/price-lists-architecture.md. Absorve o CONCEITO do Tiny
// (ListaPrecoResponseModel + ExcecaoListaPrecoModel), não a implementação
// exata: aqui é só um percentual de ajuste + exceções pontuais por produto.
// Este arquivo contém só o TIPO e as funções PURAS de validação/cálculo —
// nenhuma chamada a Prisma aqui, mesma disciplina do resto do domínio nesta
// base.
export interface PriceList {
  id: string;
  tenantId: string;
  name: string;
  adjustmentPct: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceListCreateData {
  tenantId: string;
  name: string;
  adjustmentPct: number;
}

export type PriceListUpdateData = Partial<Pick<PriceListCreateData, 'name' | 'adjustmentPct'>>;

export interface PriceListException {
  id: string;
  tenantId: string;
  priceListId: string;
  productId: string;
  overridePrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PriceListExceptionCreateData {
  tenantId: string;
  priceListId: string;
  productId: string;
  overridePrice: number;
}

export function isValidName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 100;
}

// Um único campo com sinal (positivo = acréscimo, negativo = desconto) em
// vez do par tipoAjuste+valor que outras modelagens usariam — mesma
// filosofia de simplificação do resto do benchmark (ver comentário em
// prisma/schema.prisma, model PriceList). Piso em -100 (exclusive): um
// desconto de 100% ou mais zeraria/inverteria o preço, o que nunca é uma
// política de lista de preços real — mesmo racional de isValidLeadTimeDays
// (guarda contra erro de digitação óbvio, não uma lista fechada de valores).
// Teto de 1000% cobre qualquer markup razoável sem trava artificial baixa.
export function isValidAdjustmentPct(value: number): boolean {
  return Number.isFinite(value) && value > -100 && value <= 1000;
}

export function isValidOverridePrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// O cálculo em si: se existe uma exceção para este produto NESTA lista, o
// preço override sempre vence — a exceção existe exatamente para sobrepor a
// regra geral. Caso contrário, aplica o percentual da lista sobre o
// basePrice informado por quem consulta (a lista nunca sabe de onde veio
// esse valor — pode ser o preço ideal calculado pelo PricingStrategist, o
// erpSalePrice, ou qualquer outra fonte que o chamador escolher).
export function resolveListPrice(
  basePrice: number,
  adjustmentPct: number,
  exceptionOverridePrice?: number | null,
): number {
  if (exceptionOverridePrice !== undefined && exceptionOverridePrice !== null) {
    return exceptionOverridePrice;
  }
  // Arredonda para centavos: preço é sempre 2 casas decimais, e
  // multiplicação por ponto flutuante gera resíduos (100 * 1.1 =
  // 110.00000000000001) que não deveriam vazar pra fora desta função pura.
  return Math.round(basePrice * (1 + adjustmentPct / 100) * 100) / 100;
}
