// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 1.4/Fase 1) — Contas a Pagar. Espelho do lado "a pagar" de
// ReceivableRecord (receivable-record.entity.ts) — ver prisma/schema.prisma,
// model AccountsPayable, para o racional completo do desenho (schema
// compartilhado financial_intelligence, referência solta a Supplier).
export type AccountsPayableOccurrence = 'UNICA' | 'SEMANAL' | 'MENSAL' | 'TRIMESTRAL' | 'PARCELADA';

// Fonte única de verdade da lista — usada tanto para validar valor recebido
// via DTO quanto para qualquer lugar que precise iterar as ocorrências.
export const ACCOUNTS_PAYABLE_OCCURRENCES: readonly AccountsPayableOccurrence[] = [
  'UNICA',
  'SEMANAL',
  'MENSAL',
  'TRIMESTRAL',
  'PARCELADA',
];

export function isValidOccurrence(value: string): value is AccountsPayableOccurrence {
  return (ACCOUNTS_PAYABLE_OCCURRENCES as readonly string[]).includes(value);
}

export type AccountsPayableStatus = 'PENDING' | 'PAID' | 'CANCELLED';

// Status "de leitura" — OVERDUE nunca é persistido (ver resolveEffectiveStatus
// abaixo), sempre derivado na hora da consulta. Evita precisar de um job que
// varre e atualiza linhas vencidas — vai além do que ReceivableStatus.OVERDUE
// documenta (aquele É gravado por um job futuro; este nunca precisa ser).
export type AccountsPayableEffectiveStatus = AccountsPayableStatus | 'OVERDUE';

export interface AccountsPayable {
  id: string;
  tenantId: string;
  amount: number;
  status: AccountsPayableStatus;
  description: string;
  category: string | null;
  supplierId: string | null;
  dueDate: Date;
  paidAt: Date | null;
  occurrence: AccountsPayableOccurrence;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  notes: string | null;
  // Quick Win 4 (benchmark Bling, 29/07/2026, docs/bling-erp-benchmark-analysis.md,
  // seção 2 — ContasBaixarContaDTO: juros/desconto/acrescimo/valorRecebido/tarifa)
  // — todos null até a baixa (markPaid). Baixa parcial/com ajuste é o normal
  // na vida real: o valor efetivamente pago quase nunca é idêntico ao valor
  // original da conta (juros por atraso, desconto negociado, tarifa da forma
  // de pagamento). paidAmount é o valor de fato baixado; os três campos
  // seguintes são o detalhamento do ajuste (ver resolvePaidAmount).
  paidAmount: number | null;
  interestAmount: number | null; // juros
  discountAmount: number | null; // desconto
  feeAmount: number | null; // tarifa (taxa da forma de pagamento, ex.: boleto, cartão)
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountsPayableCreateData {
  tenantId: string;
  amount: number;
  description: string;
  category?: string | null;
  supplierId?: string | null;
  dueDate: Date;
  occurrence: AccountsPayableOccurrence;
  notes?: string | null;
  installmentGroupId?: string | null;
  installmentNumber?: number | null;
  totalInstallments?: number | null;
}

export type AccountsPayableUpdateData = Partial<
  Pick<AccountsPayableCreateData, 'description' | 'category' | 'supplierId' | 'dueDate' | 'notes'>
>;

export function isValidDescription(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200;
}

export function isValidAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// Quick Win 4 (benchmark Bling) — ajustes opcionais de baixa. Todos os três
// são valores POSITIVOS (uma "desconto" é expressa como redução, nunca como
// um número negativo somado) — mesmo racional de nunca deixar quem chama
// "inventar" sinal, ver isValidSettlementAdjustments.
export interface AccountsPayableSettlementAdjustments {
  interestAmount?: number; // juros — acréscimo por atraso
  discountAmount?: number; // desconto — negociado com o fornecedor
  feeAmount?: number; // tarifa — taxa da forma de pagamento
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isValidSettlementAdjustments(adjustments: AccountsPayableSettlementAdjustments): boolean {
  const values = [adjustments.interestAmount, adjustments.discountAmount, adjustments.feeAmount];
  return values.every((value) => value === undefined || (Number.isFinite(value) && value >= 0));
}

// Função pura: valor de fato baixado = valor original + juros - desconto +
// tarifa. Nunca aplicada silenciosamente — o service SEMPRE grava os
// componentes individuais junto do resultado, para a trilha de auditoria
// nunca depender de recalcular a partir só do total (ver AccountsPayableService.markPaid).
export function resolvePaidAmount(faceAmount: number, adjustments: AccountsPayableSettlementAdjustments = {}): number {
  const interest = adjustments.interestAmount ?? 0;
  const discount = adjustments.discountAmount ?? 0;
  const fee = adjustments.feeAmount ?? 0;
  return round2(faceAmount + interest - discount + fee);
}

// Deriva OVERDUE em cima de PENDING quando já passou do vencimento — nunca
// se aplica a PAID/CANCELLED (ambos terminais, "vencido" não faz sentido
// para eles). Mesmo racional de orders/domain/order-status-guard.ts
// (resolveEffectiveStatus): função pura, sem I/O, chamada tanto na listagem
// quanto na leitura individual, nunca gravada de volta no banco.
export function resolveEffectiveStatus(
  payable: Pick<AccountsPayable, 'status' | 'dueDate'>,
  now: Date,
): AccountsPayableEffectiveStatus {
  if (payable.status !== 'PENDING') return payable.status;
  return payable.dueDate.getTime() < now.getTime() ? 'OVERDUE' : 'PENDING';
}

export interface InstallmentLine {
  amount: number;
  dueDate: Date;
  installmentNumber: number;
  totalInstallments: number;
}

// Rateio de parcelas — função pura, mesmo racional de domain/dre-report.ts
// (zero I/O, 100% testável). Distribui `totalAmount` em `totalInstallments`
// parcelas iguais, jogando o resto de centavos (arredondamento) na ÚLTIMA
// parcela — convenção comum de boleto parcelado (100,00 / 3 = 33,33 + 33,33
// + 33,34, nunca 33,34 + 33,33 + 33,33). Trabalha em centavos (inteiros) na
// divisão pra nunca acumular erro de ponto flutuante.
function buildInstallmentAmounts(totalAmount: number, totalInstallments: number): number[] {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / totalInstallments);
  const remainderCents = totalCents - baseCents * totalInstallments;
  return Array.from({ length: totalInstallments }, (_, index) => {
    const cents = index === totalInstallments - 1 ? baseCents + remainderCents : baseCents;
    return cents / 100;
  });
}

// dueDate de cada parcela avança 1 mês a partir de `firstDueDate` — MVP
// assume parcelamento mensal (o caso de longe mais comum); parcelamento
// semanal/quinzenal fica para quando (se) houver demanda real, mesmo limite
// documentado em AccountsPayableOccurrence.PARCELADA no schema.
function buildInstallmentDueDates(firstDueDate: Date, totalInstallments: number): Date[] {
  return Array.from({ length: totalInstallments }, (_, index) => {
    const date = new Date(firstDueDate);
    date.setMonth(date.getMonth() + index);
    return date;
  });
}

// Ponto de entrada único — combina valor+data em N linhas prontas para virar
// N `AccountsPayableCreateData` no service (que aí sim atribui o
// installmentGroupId, gerado ali por ser um efeito colateral/id, não algo
// que uma função pura de domínio deveria produzir).
export function buildInstallmentPlan(totalAmount: number, totalInstallments: number, firstDueDate: Date): InstallmentLine[] {
  if (!Number.isInteger(totalInstallments) || totalInstallments < 2) {
    throw new Error('totalInstallments deve ser um inteiro >= 2 — use occurrence UNICA para uma conta só.');
  }
  const amounts = buildInstallmentAmounts(totalAmount, totalInstallments);
  const dueDates = buildInstallmentDueDates(firstDueDate, totalInstallments);
  return amounts.map((amount, index) => ({
    amount,
    dueDate: dueDates[index],
    installmentNumber: index + 1,
    totalInstallments,
  }));
}
