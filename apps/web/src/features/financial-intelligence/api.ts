import { apiClient } from '../../lib/api-client';
import type { AppDataMode } from '../app-mode/api';

// Espelha 1:1 apps/api/src/modules/financial-intelligence/domain/dre-report.ts
// — mesmo racional de duplicação intencional do resto do frontend (o
// frontend nunca importa tipo do backend, só replica o formato do JSON;
// datas chegam como string, nunca Date de verdade).
export type DreDataQuality = 'COMPLETE' | 'INCOMPLETE';

export interface DreChannelBreakdown {
  channelCode: string;
  orderCount: number;
  receitaBruta: number;
  deducoes: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPct: number | null;
  // Publicidade (01/08/2026) — linha separada da margem de contribuição
  // porque Ads é custo de PERÍODO, não de pedido.
  custoAds: number;
  margemAposAds: number;
  margemAposAdsPct: number | null;
  // false = nunca houve sincronização de Ads neste canal/período. Distingue
  // "não anunciou" (true, custoAds 0) de "não sabemos" (false).
  adSpendDataAvailable: boolean;
  dataQuality: DreDataQuality;
}

export interface DreIncompleteOrderRef {
  orderId: string;
  externalOrderId: string;
  channelCode: string;
  reasons: string[];
}

// Sprint 23 (Fase de Conexão Real) — uma linha por pedido, fonte da tabela
// "Pedido / Valor Total / Taxas / CMV / Margem Líquida" pedida pelo usuário.
export interface DreOrderLine {
  orderId: string;
  externalOrderId: string;
  channelCode: string;
  orderedAt: string;
  totalAmount: number;
  feeAmount: number;
  cmv: number;
  margemLiquida: number;
  // Publicidade atribuída a este pedido (01/08/2026). O gasto por SKU é
  // dado real do canal; o que é dividido aqui é esse gasto entre os pedidos
  // do mesmo SKU no período.
  custoAdsRateado: number;
  margemLiquidaAposAds: number;
  dataQuality: DreDataQuality;
}

export interface DreReport {
  tenantId: string;
  periodFrom: string | null;
  periodTo: string | null;
  generatedAt: string;
  receitaBruta: number;
  deducoes: number;
  custosVariaveis: number;
  margemContribuicao: number;
  margemContribuicaoPct: number | null;
  custoAds: number;
  margemAposAds: number;
  margemAposAdsPct: number | null;
  // Despesas fixas rateadas no período e o resultado operacional (01/08/2026).
  // NÃO inclui contas a pagar: aquelas contêm compra de estoque, que já
  // está em custosVariaveis como CMV — somar contaria duas vezes.
  despesasFixas: number;
  resultadoOperacional: number;
  resultadoOperacionalPct: number | null;
  // false quando o período é aberto — não dá para ratear despesa recorrente
  // num intervalo sem fim.
  despesasFixasApuradas: boolean;
  dataQuality: DreDataQuality;
  channels: DreChannelBreakdown[];
  incompleteOrders: DreIncompleteOrderRef[];
  orderLines: DreOrderLine[];
}

export interface DreQuery {
  dateFrom?: string;
  dateTo?: string;
  mode?: AppDataMode;
}

export async function fetchDreReport(query: DreQuery = {}): Promise<DreReport> {
  const { data } = await apiClient.get<DreReport>('/financial-intelligence/dre', { params: query });
  return data;
}

// ---------------------------------------------------------------------------
// Contas a Pagar — espelha financial-intelligence/domain/accounts-payable.entity.ts
// ---------------------------------------------------------------------------

export type AccountsPayableOccurrence = 'UNICA' | 'SEMANAL' | 'MENSAL' | 'TRIMESTRAL' | 'PARCELADA';
export type AccountsPayableStatus = 'PENDING' | 'PAID' | 'CANCELLED';
export type AccountsPayableEffectiveStatus = AccountsPayableStatus | 'OVERDUE';

export interface AccountsPayable {
  id: string;
  amount: number;
  status: AccountsPayableStatus;
  description: string;
  category: string | null;
  supplierId: string | null;
  dueDate: string;
  paidAt: string | null;
  occurrence: AccountsPayableOccurrence;
  installmentGroupId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  notes: string | null;
  paidAmount: number | null;
  interestAmount: number | null;
  discountAmount: number | null;
  feeAmount: number | null;
}

export interface CreateAccountsPayableInput {
  amount: number;
  description: string;
  category?: string;
  supplierId?: string;
  dueDate: string;
  occurrence: AccountsPayableOccurrence;
  notes?: string;
  totalInstallments?: number;
}

export interface MarkAccountsPayablePaidInput {
  paidAt?: string;
  interestAmount?: number;
  discountAmount?: number;
  feeAmount?: number;
}

// Deriva OVERDUE — mesma função pura do backend (resolveEffectiveStatus),
// duplicada aqui de propósito (mesmo racional do resto do frontend: nunca
// importa código do backend, só replica o comportamento).
export function resolveAccountsPayableEffectiveStatus(payable: AccountsPayable, now: Date = new Date()): AccountsPayableEffectiveStatus {
  if (payable.status !== 'PENDING') return payable.status;
  return new Date(payable.dueDate).getTime() < now.getTime() ? 'OVERDUE' : 'PENDING';
}

export async function fetchAccountsPayable(status?: AccountsPayableStatus): Promise<AccountsPayable[]> {
  const { data } = await apiClient.get<AccountsPayable[]>('/financial-intelligence/accounts-payable', {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function createAccountsPayable(input: CreateAccountsPayableInput): Promise<AccountsPayable[]> {
  const { data } = await apiClient.post<AccountsPayable[]>('/financial-intelligence/accounts-payable', input);
  return data;
}

export async function markAccountsPayablePaid(id: string, input: MarkAccountsPayablePaidInput): Promise<AccountsPayable> {
  const { data } = await apiClient.post<AccountsPayable>(`/financial-intelligence/accounts-payable/${id}/pagar`, input);
  return data;
}

export async function cancelAccountsPayable(id: string): Promise<void> {
  await apiClient.delete(`/financial-intelligence/accounts-payable/${id}`);
}

// ---------------------------------------------------------------------------
// Despesas Fixas — espelha financial-intelligence/domain/fixed-expense.entity.ts
// ---------------------------------------------------------------------------

export type FixedExpenseRecurrence = 'MONTHLY' | 'WEEKLY' | 'YEARLY' | 'ONE_TIME';

export interface FixedExpense {
  id: string;
  name: string;
  amount: number;
  recurrenceType: FixedExpenseRecurrence;
  dueDay: number | null;
}

export interface CreateFixedExpenseInput {
  name: string;
  amount: number;
  recurrenceType: FixedExpenseRecurrence;
  dueDay?: number;
}

export async function fetchFixedExpenses(): Promise<FixedExpense[]> {
  const { data } = await apiClient.get<FixedExpense[]>('/financial-intelligence/fixed-expenses');
  return data;
}

export async function createFixedExpense(input: CreateFixedExpenseInput): Promise<FixedExpense> {
  const { data } = await apiClient.post<FixedExpense>('/financial-intelligence/fixed-expenses', input);
  return data;
}

export async function deleteFixedExpense(id: string): Promise<void> {
  await apiClient.delete(`/financial-intelligence/fixed-expenses/${id}`);
}

// ---------------------------------------------------------------------------
// Recebíveis / Reconciliação — espelha financial-intelligence/domain/receivable-record.entity.ts
// ---------------------------------------------------------------------------

export type ReceivableStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface ReceivableRecord {
  id: string;
  amount: number;
  status: ReceivableStatus;
  expectedDate: string;
  paidAt: string | null;
  marketplaceSource: string;
  externalReference: string | null;
  skuCode: string | null;
}

export async function fetchReceivables(status?: ReceivableStatus): Promise<ReceivableRecord[]> {
  const { data } = await apiClient.get<ReceivableRecord[]>('/financial-intelligence/receivables', {
    params: status ? { status } : undefined,
  });
  return data;
}

export interface ImportSettlementInput {
  marketplaceCode: string;
  format: 'JSON' | 'CSV';
  fileContent: string;
}

export interface ImportSettlementResult {
  matched: number;
  alreadyReconciled: number;
  unmatchedReferences: string[];
}

export async function importSettlement(input: ImportSettlementInput): Promise<ImportSettlementResult> {
  const { data } = await apiClient.post<ImportSettlementResult>('/financial-intelligence/settlements/import', input);
  return data;
}
