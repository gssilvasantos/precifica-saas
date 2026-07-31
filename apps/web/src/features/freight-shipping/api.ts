import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/src/modules/freight-shipping/application/ports/*.port.ts
// — mesmo racional de duplicação intencional do resto do frontend.
export interface Carrier {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CarrierService {
  id: string;
  tenantId: string;
  carrierId: string;
  name: string;
  aliases: string[];
  estimativaEntregaDias: number | null;
  automationCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CarrierServiceInput {
  name: string;
  aliases?: string[];
  estimativaEntregaDias?: number;
  automationCode?: string;
}

export async function fetchCarriers(): Promise<Carrier[]> {
  const { data } = await apiClient.get<Carrier[]>('/freight-shipping/carriers');
  return data;
}

export async function createCarrier(name: string): Promise<Carrier> {
  const { data } = await apiClient.post<Carrier>('/freight-shipping/carriers', { name });
  return data;
}

export async function updateCarrier(id: string, name: string): Promise<Carrier> {
  const { data } = await apiClient.patch<Carrier>(`/freight-shipping/carriers/${id}`, { name });
  return data;
}

export async function setCarrierActive(id: string, isActive: boolean): Promise<Carrier> {
  const { data } = await apiClient.patch<Carrier>(`/freight-shipping/carriers/${id}/active`, { isActive });
  return data;
}

export async function fetchCarrierServices(carrierId: string): Promise<CarrierService[]> {
  const { data } = await apiClient.get<CarrierService[]>(`/freight-shipping/carriers/${carrierId}/services`);
  return data;
}

export async function createCarrierService(carrierId: string, input: CarrierServiceInput): Promise<CarrierService> {
  const { data } = await apiClient.post<CarrierService>(`/freight-shipping/carriers/${carrierId}/services`, input);
  return data;
}

export async function updateCarrierService(carrierId: string, serviceId: string, input: Partial<CarrierServiceInput>): Promise<CarrierService> {
  const { data } = await apiClient.patch<CarrierService>(`/freight-shipping/carriers/${carrierId}/services/${serviceId}`, input);
  return data;
}

export async function setCarrierServiceActive(carrierId: string, serviceId: string, isActive: boolean): Promise<CarrierService> {
  const { data } = await apiClient.patch<CarrierService>(`/freight-shipping/carriers/${carrierId}/services/${serviceId}/active`, { isActive });
  return data;
}

// --- Conexões com transportadoras (Melhor Envio, Olist Envios, Frenet, Correios) ---

export interface FreightConnection {
  id: string;
  tenantId: string;
  providerCode: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchFreightConnections(): Promise<FreightConnection[]> {
  const { data } = await apiClient.get<FreightConnection[]>('/freight-shipping/connections');
  return data;
}

export async function upsertFreightConnection(providerCode: string, credential: Record<string, unknown>): Promise<FreightConnection> {
  const { data } = await apiClient.post<FreightConnection>('/freight-shipping/connections', { providerCode, credential });
  return data;
}

export async function removeFreightConnection(providerCode: string): Promise<void> {
  await apiClient.delete(`/freight-shipping/connections/${providerCode}`);
}
