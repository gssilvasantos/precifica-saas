import { apiClient } from '../../lib/api-client';

// Espelha 1:1 os records dos repositórios do backend
// (apps/api/src/modules/fiscal/application/ports/*.port.ts) — mesmo
// racional de duplicação intencional do resto do frontend (nunca importa
// tipo do backend, só replica o formato do JSON; datas chegam como string).

// ---------------------------------------------------------------------------
// Configurações do emitente — fiscal/settings.controller.ts
// ---------------------------------------------------------------------------

export type FiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';

export interface FiscalSettings {
  tenantId: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoEstadual: string;
  regimeTributario: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string | null;
  environment: FiscalEnvironment;
  autoEmitOnApproval: boolean;
  nfeSerie: number | null;
  defaultNaturezaOperacaoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const REGIME_TRIBUTARIO_LABEL: Record<number, string> = {
  1: 'Simples Nacional',
  2: 'Simples Nacional (excesso de sublimite)',
  3: 'Regime Normal',
};

export interface UpsertFiscalSettingsInput {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  inscricaoEstadual: string;
  regimeTributario?: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone?: string;
  // Só enviar ao cadastrar pela primeira vez ou ao rotacionar o token —
  // ausente numa atualização mantém o token já salvo no backend.
  focusNfeToken?: string;
  environment?: FiscalEnvironment;
  autoEmitOnApproval?: boolean;
  nfeSerie?: number;
  defaultNaturezaOperacaoId?: string | null;
}

export async function fetchFiscalSettings(): Promise<FiscalSettings | null> {
  const { data } = await apiClient.get<FiscalSettings | null>('/fiscal/settings');
  return data;
}

export async function upsertFiscalSettings(input: UpsertFiscalSettingsInput): Promise<FiscalSettings> {
  const { data } = await apiClient.put<FiscalSettings>('/fiscal/settings', input);
  return data;
}

// ---------------------------------------------------------------------------
// Naturezas de Operação (CFOP) — fiscal/naturezas-operacao.controller.ts
// ---------------------------------------------------------------------------

export interface NaturezaOperacao {
  id: string;
  tenantId: string;
  nome: string;
  cfopVendaInterno: string;
  cfopVendaInterestadual: string;
  cfopDevolucaoInterno: string | null;
  cfopDevolucaoInterestadual: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNaturezaOperacaoInput {
  nome: string;
  cfopVendaInterno: string;
  cfopVendaInterestadual: string;
  cfopDevolucaoInterno?: string;
  cfopDevolucaoInterestadual?: string;
}

export type UpdateNaturezaOperacaoInput = Partial<CreateNaturezaOperacaoInput>;

export async function fetchNaturezasOperacao(): Promise<NaturezaOperacao[]> {
  const { data } = await apiClient.get<NaturezaOperacao[]>('/fiscal/naturezas-operacao');
  return data;
}

export async function createNaturezaOperacao(input: CreateNaturezaOperacaoInput): Promise<NaturezaOperacao> {
  const { data } = await apiClient.post<NaturezaOperacao>('/fiscal/naturezas-operacao', input);
  return data;
}

export async function updateNaturezaOperacao(id: string, input: UpdateNaturezaOperacaoInput): Promise<NaturezaOperacao> {
  const { data } = await apiClient.patch<NaturezaOperacao>(`/fiscal/naturezas-operacao/${id}`, input);
  return data;
}

export async function setNaturezaOperacaoActive(id: string, isActive: boolean): Promise<NaturezaOperacao> {
  const { data } = await apiClient.patch<NaturezaOperacao>(`/fiscal/naturezas-operacao/${id}/active`, { isActive });
  return data;
}

// ---------------------------------------------------------------------------
// Intermediador de marketplace na NF-e (Grupo G / NT 2020.006) —
// fiscal/marketplace-intermediaries.controller.ts
// ---------------------------------------------------------------------------

export interface FiscalMarketplaceIntermediary {
  id: string;
  tenantId: string;
  channelCode: string;
  cnpj: string;
  idCadIntTran: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertFiscalMarketplaceIntermediaryInput {
  channelCode: string;
  cnpj: string;
  idCadIntTran: string;
}

export async function fetchFiscalIntermediaries(): Promise<FiscalMarketplaceIntermediary[]> {
  const { data } = await apiClient.get<FiscalMarketplaceIntermediary[]>('/fiscal/marketplace-intermediaries');
  return data;
}

export async function upsertFiscalIntermediary(
  input: UpsertFiscalMarketplaceIntermediaryInput,
): Promise<FiscalMarketplaceIntermediary> {
  const { data } = await apiClient.put<FiscalMarketplaceIntermediary>('/fiscal/marketplace-intermediaries', input);
  return data;
}

export async function removeFiscalIntermediary(channelCode: string): Promise<void> {
  await apiClient.delete(`/fiscal/marketplace-intermediaries/${channelCode}`);
}
