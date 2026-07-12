import { VideoCaptureSession, VideoCaptureSessionCreateData } from '../../domain/video-capture.entity';

// Sprint 27 (Pick & Pack) — porta da sessão de captura de vídeo em chunks.
export interface VideoCaptureSessionRepository {
  create(data: VideoCaptureSessionCreateData): Promise<VideoCaptureSession>;
  findById(tenantId: string, id: string): Promise<VideoCaptureSession | null>;
  findByAuditEvent(tenantId: string, auditEventId: string): Promise<VideoCaptureSession | null>;
  // Chamado DEPOIS que o chunk já foi persistido fisicamente no storage
  // (nunca antes) — incrementa o contador de chunks e bytes recebidos.
  recordChunkReceived(id: string, chunkSize: number): Promise<VideoCaptureSession>;
  finalize(id: string): Promise<VideoCaptureSession>;
  // Job de retenção (30 dias) — marca o vídeo como limpo; a LINHA nunca é
  // apagada (é o registro permanente de que a conferência aconteceu).
  markVideoDeleted(id: string): Promise<VideoCaptureSession>;
  // Sessões FINALIZED com finalizedAt <= cutoff e videoDeletedAt nulo —
  // usado pelo job de limpeza para nunca escanear a tabela toda.
  findExpiredForCleanup(cutoff: Date): Promise<VideoCaptureSession[]>;
}

export const VIDEO_CAPTURE_SESSION_REPOSITORY = Symbol('VIDEO_CAPTURE_SESSION_REPOSITORY');
