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
