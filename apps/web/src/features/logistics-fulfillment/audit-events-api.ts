import { apiClient } from '../../lib/api-client';

// Espelha 1:1 apps/api/.../logistics-fulfillment/domain/stock-movement-audit-event.entity.ts
// e video-capture.entity.ts (Sprint 27, Pick & Pack) — mesmo racional de
// duplicação intencional do resto do frontend (nunca importa tipo do
// backend, só replica o formato do JSON; datas chegam como string).
export type StockMovementEventType = 'RETAIL_SHIPMENT' | 'FULL_DISPATCH';
export type ConferenceStatus = 'PENDENTE' | 'APROVADO' | 'DIVERGENTE';

export interface StockMovementAuditEvent {
  id: string;
  tenantId: string;
  eventType: StockMovementEventType;
  sourceWarehouseId: string;
  destinationWarehouseId: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  conferenceStatus: ConferenceStatus;
  conferredByUserId: string | null;
  conferredAt: string | null;
  divergenceNotes: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  updatedAt: string;
  orderIds: string[];
}

export interface ChecklistItem {
  id: string;
  tenantId: string;
  auditEventId: string;
  skuCode: string;
  expectedQuantity: number;
  scannedQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export type VideoCaptureStatus = 'RECORDING' | 'FINALIZED';

export interface VideoCaptureSession {
  id: string;
  tenantId: string;
  auditEventId: string;
  storageKey: string;
  status: VideoCaptureStatus;
  receivedChunkCount: number;
  totalBytes: number;
  startedAt: string;
  finalizedAt: string | null;
  videoDeletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const BASE = '/logistics-fulfillment/audit-events';

// Fila de trabalho — eventos PENDENTES do tenant, mais antigos primeiro
// (FIFO). É como a tela de conferência descobre qual evento abrir.
export async function fetchPendingQueue(): Promise<StockMovementAuditEvent[]> {
  const { data } = await apiClient.get<StockMovementAuditEvent[]>(`${BASE}/pending`);
  return data;
}

export async function fetchAuditEvent(eventId: string): Promise<StockMovementAuditEvent> {
  const { data } = await apiClient.get<StockMovementAuditEvent>(`${BASE}/${eventId}`);
  return data;
}

export async function fetchChecklist(eventId: string): Promise<ChecklistItem[]> {
  const { data } = await apiClient.get<ChecklistItem[]>(`${BASE}/${eventId}/checklist`);
  return data;
}

// Bipagem — sempre +1 no backend, nunca aceita quantidade absoluta daqui.
export async function scanItem(eventId: string, skuCode: string): Promise<ChecklistItem> {
  const { data } = await apiClient.post<ChecklistItem>(`${BASE}/${eventId}/scan`, { skuCode });
  return data;
}

export async function approveAuditEvent(
  eventId: string,
  lines: { skuCode: string; quantity: number }[],
): Promise<StockMovementAuditEvent> {
  const { data } = await apiClient.post<StockMovementAuditEvent>(`${BASE}/${eventId}/approve`, { lines });
  return data;
}

export async function markDivergent(eventId: string, divergenceNotes: string): Promise<StockMovementAuditEvent> {
  const { data } = await apiClient.post<StockMovementAuditEvent>(`${BASE}/${eventId}/divergent`, { divergenceNotes });
  return data;
}

// --- Captura de vídeo em chunks (Sprint 27) ---
// Idempotente: reabrir a tela devolve a MESMA sessão em vez de criar outra.
export async function startVideoSession(eventId: string): Promise<VideoCaptureSession> {
  const { data } = await apiClient.post<VideoCaptureSession>(`${BASE}/${eventId}/video-sessions`);
  return data;
}

// 404 é esperado (ainda não existe sessão) — o chamador decide o que fazer.
export async function fetchVideoSession(eventId: string): Promise<VideoCaptureSession | null> {
  try {
    const { data } = await apiClient.get<VideoCaptureSession>(`${BASE}/${eventId}/video-sessions`);
    return data;
  } catch (error) {
    return null;
  }
}

// Converte o Blob do MediaRecorder para base64 (o corpo do POST é JSON,
// mesma simplificação consciente do resto da API — evita multipart só para
// este endpoint). `sequence` é o número de ordem do chunk (0, 1, 2, ...),
// controlado pelo chamador — é o que permite o servidor detectar
// retransmissão ou lacuna de rede.
export async function appendVideoChunk(eventId: string, sessionId: string, sequence: number, chunk: Blob): Promise<VideoCaptureSession> {
  const contentBase64 = await blobToBase64(chunk);
  const { data } = await apiClient.post<VideoCaptureSession>(`${BASE}/${eventId}/video-sessions/${sessionId}/chunks`, {
    sequence,
    contentBase64,
  });
  return data;
}

export async function finalizeVideoSession(eventId: string, sessionId: string): Promise<VideoCaptureSession> {
  const { data } = await apiClient.post<VideoCaptureSession>(`${BASE}/${eventId}/video-sessions/${sessionId}/finalize`);
  return data;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // FileReader.readAsDataURL devolve "data:<mime>;base64,<conteudo>" — só
      // o conteúdo depois da vírgula é o que a API espera.
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
