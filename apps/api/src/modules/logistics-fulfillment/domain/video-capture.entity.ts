// Sessão de captura de vídeo em chunks (Sprint 27, "Pick & Pack") — 1:1 com
// um StockMovementAuditEvent. Estratégia: MediaDevices API no navegador
// (MediaRecorder com timeslice) enviando cada blob incrementalmente ao
// backend, que faz append no arquivo em disco (nunca reescreve do zero) —
// ver docs/pick-pack-architecture.md, seção 2, para o racional completo
// contra RTSP/streaming dedicado. Este arquivo só contém TIPOS e funções
// PURAS — nenhuma chamada a disco/Prisma aqui, mesmo racional de
// domain/stock-movement-audit-event.entity.ts.
export type VideoCaptureStatus = 'RECORDING' | 'FINALIZED';

export interface VideoCaptureSession {
  id: string;
  tenantId: string;
  auditEventId: string;
  storageKey: string;
  status: VideoCaptureStatus;
  receivedChunkCount: number;
  totalBytes: number;
  startedAt: Date;
  finalizedAt: Date | null;
  // Retenção de 30 dias — preenchido pelo job de limpeza quando o ARQUIVO
  // físico é apagado. Esta linha (metadado) nunca é apagada.
  videoDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoCaptureSessionCreateData {
  tenantId: string;
  auditEventId: string;
  storageKey: string;
}

export interface VideoGateCheck {
  ok: boolean;
  reason?: string;
  // true quando o chunk já tinha sido recebido antes (retransmissão por
  // rede instável) — aceito de forma idempotente, sem reescrever o arquivo.
  isDuplicate?: boolean;
}

// Idempotência de upload de chunk: sequence é 0-based, igual a
// receivedChunkCount no momento em que o chunk é aceito pela primeira vez.
// Um chunk com sequence < receivedChunkCount é uma retransmissão (cliente
// não recebeu o ACK e reenviou) — aceito sem duplicar bytes no arquivo.
// sequence > receivedChunkCount é uma lacuna (chunk anterior nunca chegou)
// — rejeitado, porque um MediaRecorder de fluxo único não pode ser
// reconstruído fora de ordem sem corromper o container de vídeo.
export function canAcceptChunk(
  session: Pick<VideoCaptureSession, 'status' | 'receivedChunkCount'>,
  sequence: number,
): VideoGateCheck {
  if (session.status !== 'RECORDING') {
    return { ok: false, reason: `Sessão de captura já está ${session.status} — não aceita mais chunks.` };
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    return { ok: false, reason: 'Número de sequência do chunk inválido.' };
  }
  if (sequence < session.receivedChunkCount) {
    return { ok: true, isDuplicate: true };
  }
  if (sequence > session.receivedChunkCount) {
    return {
      ok: false,
      reason: `Chunk fora de ordem (esperado ${session.receivedChunkCount}, recebido ${sequence}) — possível lacuna de rede.`,
    };
  }
  return { ok: true, isDuplicate: false };
}

// Não permite finalizar uma sessão sem nenhum chunk recebido — uma
// "captura vazia" não é prova visual nenhuma, contradiria o Objetivo Zero
// Erro tanto quanto aprovar sem mídia nenhuma.
export function canFinalize(session: Pick<VideoCaptureSession, 'status' | 'receivedChunkCount'>): VideoGateCheck {
  if (session.status !== 'RECORDING') {
    return { ok: false, reason: `Sessão de captura já está ${session.status} — não pode ser finalizada de novo.` };
  }
  if (session.receivedChunkCount === 0) {
    return { ok: false, reason: 'Nenhum chunk de vídeo recebido ainda — não é possível finalizar uma captura vazia.' };
  }
  return { ok: true };
}

// Retenção de 30 dias (premissa de negócio nº 3) — função pura para o job
// de limpeza decidir, testável sem relógio real (`now` é sempre explícito).
export const VIDEO_RETENTION_DAYS = 30;

export function isExpiredForRetention(
  session: Pick<VideoCaptureSession, 'status' | 'finalizedAt' | 'videoDeletedAt'>,
  now: Date,
  retentionDays: number = VIDEO_RETENTION_DAYS,
): boolean {
  if (session.status !== 'FINALIZED' || !session.finalizedAt) return false;
  if (session.videoDeletedAt) return false; // já limpo antes — idempotente, nunca reprocessa
  const ageMs = now.getTime() - session.finalizedAt.getTime();
  return ageMs >= retentionDays * 24 * 60 * 60 * 1000;
}
