import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/tax-intelligence/interface/controllers/
// prior-revenue.controller.ts + PriorRevenueService.
//
// DÍVIDA CONHECIDA: cópia manual do contrato, o compilador não avisa quando
// divergir. Mudou o serviço, atualize aqui na MESMA fatia.

export type OrigemDoMes = 'INFORMADA' | 'PEDIDOS_KYNETI' | 'FALTANDO';
export type FonteReceita = 'MANUAL' | 'PGDAS_D' | 'DASN_SIMEI';

export interface MesDaJanela {
  competencia: string; // 'YYYY-MM'
  receitaMercadoInterno: number | null;
  receitaMercadoExterno: number | null;
  receitaDePedidos: number | null;
  origem: OrigemDoMes;
  fonte: string | null;
}

export interface JanelaRbt12 {
  periodoApuracao: string;
  meses: MesDaJanela[];
  // Quantos meses ainda impedem o cálculo. Zero = o Simples destrava.
  mesesFaltantes: number;
  rbt12Parcial: number;
}

export interface CompetenciaInput {
  competencia: string; // ISO 8601
  receitaMercadoInterno: number;
  receitaMercadoExterno: number;
  fonte: FonteReceita;
}

export async function fetchJanelaRbt12(periodoApuracao?: string): Promise<JanelaRbt12> {
  const { data } = await apiClient.get<JanelaRbt12>('/tax-intelligence/faturamento-anterior', {
    params: periodoApuracao ? { periodoApuracao } : undefined,
  });
  return data;
}

// Devolve a janela já recalculada — a tela precisa saber na hora se ainda
// faltam meses para o cálculo destravar.
export async function salvarFaturamentoAnterior(linhas: CompetenciaInput[]): Promise<JanelaRbt12> {
  const { data } = await apiClient.put<JanelaRbt12>('/tax-intelligence/faturamento-anterior', { linhas });
  return data;
}
