import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/tax-intelligence/interface/controllers/
// tenant-tax-profile.controller.ts (paraResposta) e o DefinirRegimeDto.
//
// DÍVIDA CONHECIDA, igual ao resto do projeto: estes tipos são cópia manual do
// DTO do backend e o compilador não avisa quando divergem. Mudou o DTO,
// atualize aqui na MESMA fatia.
//
// CUIDADO para não confundir com a feature `tax-profiles`, que bate em
// /tax-profiles e é o perfil fiscal do CATÁLOGO — coisa diferente. Esta aqui é
// o regime tributário da empresa (Tax Intelligence).

export type TaxRegime = 'MEI_SIMEI' | 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';
export type SimplesAnexo = 'I' | 'II' | 'III' | 'IV' | 'V';
export type TaxAutomationMode = 'AUTO' | 'MANUAL';

// Percentuais chegam e saem como PERCENTUAL (0–100) — a fração é convenção
// interna do motor de cálculo e não atravessa a fronteira HTTP.
export interface RegimeTributario {
  id: string;
  uf: string;
  regime: TaxRegime;
  anexo: SimplesAnexo | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  meiValorFixoMensal: number | null;
  icmsAliquotaPct: number | null;
  presuncaoIrpjPct: number | null;
  presuncaoCsllPct: number | null;
  // Alíquota mantida à mão. null = usar a calculada.
  aliquotaManualPct: number | null;
  automationMode: TaxAutomationMode;
}

// Sugestão de reajuste. null quando não há nada a sugerir — o estado normal
// enquanto a margem de segurança do lojista existir.
export interface SugestaoDeAliquota {
  atualPct: number;
  calculadaPct: number;
  sugeridaPct: number;
  folgaPreservadaPctPontos: number;
  // Quanto o número em uso está ABAIXO do calculado. É a exposição real.
  defasagemPctPontos: number;
}

export interface DefinirRegimeInput {
  uf: string;
  regime: TaxRegime;
  anexo?: SimplesAnexo | null;
  vigenciaInicio: string; // ISO 8601
  meiValorFixoMensal?: number | null;
  icmsAliquotaPct?: number | null;
  presuncaoIrpjPct?: number | null;
  presuncaoCsllPct?: number | null;
  aliquotaManualPct?: number | null;
  automationMode?: TaxAutomationMode;
}

// Formato do 400 de validação. O backend devolve TODOS os campos inválidos de
// uma vez, e a UI associa cada mensagem ao seu campo em vez de mostrar um
// texto solto no topo.
export interface ProblemaDeValidacao {
  campo: string;
  mensagem: string;
}

export interface ErroDeRegime {
  code: 'PERFIL_TRIBUTARIO_INVALIDO' | 'VIGENCIA_RETROATIVA';
  message: string;
  problemas: ProblemaDeValidacao[];
}

// null = nunca configurado. Estado normal de onboarding, não erro — a tela
// mostra o formulário vazio, não uma mensagem de falha.
export async function fetchRegimeVigente(): Promise<RegimeTributario | null> {
  const { data } = await apiClient.get<RegimeTributario | null>('/tax-intelligence/regime');
  return data;
}

export async function fetchSugestaoDeAliquota(): Promise<SugestaoDeAliquota | null> {
  const { data } = await apiClient.get<SugestaoDeAliquota | null>('/tax-intelligence/regime/sugestao');
  return data;
}

export async function fetchHistoricoRegimes(): Promise<RegimeTributario[]> {
  const { data } = await apiClient.get<RegimeTributario[]>('/tax-intelligence/regime/historico');
  return data;
}

export async function definirRegime(input: DefinirRegimeInput): Promise<RegimeTributario> {
  const { data } = await apiClient.put<RegimeTributario>('/tax-intelligence/regime', input);
  return data;
}

// Extrai os problemas por campo de um erro do axios, quando o backend os
// enviou. Devolve mapa campo -> mensagem para o formulário associar ao input
// correspondente (regra de acessibilidade: erro associado ao campo).
export function problemasPorCampo(erro: unknown): Record<string, string> {
  const corpo = (erro as { response?: { data?: Partial<ErroDeRegime> } })?.response?.data;
  if (!corpo?.problemas) return {};

  return corpo.problemas.reduce<Record<string, string>>((acc, p) => {
    acc[p.campo] = p.mensagem;
    return acc;
  }, {});
}
