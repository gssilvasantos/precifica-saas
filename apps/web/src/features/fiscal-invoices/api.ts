import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/fiscal/domain/fiscal-invoice.entity.ts —
// mesmo racional de duplicação intencional do resto do frontend (nunca
// importa tipo do backend, só replica o formato do JSON; datas chegam como
// string).

export type FiscalInvoiceStatus = 'PENDENTE' | 'PROCESSANDO' | 'AUTORIZADA' | 'ERRO' | 'CANCELADA';
export type FiscalEnvironment = 'HOMOLOGACAO' | 'PRODUCAO';
export type NfeFinalidade = 'NORMAL' | 'COMPLEMENTAR' | 'AJUSTE' | 'DEVOLUCAO';

export interface FiscalAddress {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  pais?: string;
}

export interface FiscalInvoice {
  id: string;
  tenantId: string;
  orderId: string;
  focusRef: string;
  status: FiscalInvoiceStatus;
  environment: FiscalEnvironment;
  destNome: string;
  destDocumento: string;
  destEndereco: FiscalAddress;
  destTelefone: string | null;
  nfeNumber: string | null;
  nfeSeries: string | null;
  accessKey: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelReason: string | null;
  requestedAt: string;
  authorizedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmitInvoiceDestinatarioInput {
  nome: string;
  documento?: string;
  endereco: FiscalAddress;
  telefone?: string;
}

export interface EmitInvoiceInput {
  destinatario: EmitInvoiceDestinatarioInput;
  naturezaOperacao?: string;
  finalidade?: NfeFinalidade;
  documentoReferenciado?: string[];
  naturezaOperacaoId?: string;
}

export async function fetchAllInvoices(status?: FiscalInvoiceStatus): Promise<FiscalInvoice[]> {
  const { data } = await apiClient.get<FiscalInvoice[]>('/fiscal/invoices', { params: status ? { status } : undefined });
  return data;
}

export async function fetchInvoicesByOrder(orderId: string): Promise<FiscalInvoice[]> {
  const { data } = await apiClient.get<FiscalInvoice[]>(`/fiscal/invoices/orders/${orderId}`);
  return data;
}

export async function fetchInvoice(id: string): Promise<FiscalInvoice> {
  const { data } = await apiClient.get<FiscalInvoice>(`/fiscal/invoices/${id}`);
  return data;
}

export async function emitInvoice(orderId: string, input: EmitInvoiceInput): Promise<FiscalInvoice> {
  const { data } = await apiClient.post<FiscalInvoice>(`/fiscal/invoices/orders/${orderId}/emit`, input);
  return data;
}

export async function checkInvoiceStatus(id: string): Promise<FiscalInvoice> {
  const { data } = await apiClient.post<FiscalInvoice>(`/fiscal/invoices/${id}/check-status`, {});
  return data;
}

export async function cancelInvoice(id: string, justificativa: string): Promise<FiscalInvoice> {
  const { data } = await apiClient.post<FiscalInvoice>(`/fiscal/invoices/${id}/cancel`, { justificativa });
  return data;
}
