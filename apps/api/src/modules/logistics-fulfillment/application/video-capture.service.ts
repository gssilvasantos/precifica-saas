import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  VIDEO_CAPTURE_SESSION_REPOSITORY,
  VideoCaptureSessionRepository,
} from './ports/video-capture-session-repository.port';
import { VIDEO_CHUNK_STORAGE, VideoChunkStorage } from './ports/video-chunk-storage.port';
import {
  STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY,
  StockMovementAuditEventRepository,
} from './ports/stock-movement-audit-event-repository.port';
import { canAcceptChunk, canFinalize, isExpiredForRetention, VIDEO_RETENTION_DAYS, VideoCaptureSession } from '../domain/video-capture.entity';

// Sprint 27 (Pick & Pack) — orquestra a captura de vídeo em chunks pedida
// pelo usuário. Estratégia escolhida (ver docs/pick-pack-architecture.md,
// seção 2): MediaDevices API no navegador do operador, MediaRecorder com
// timeslice enviando cada blob incrementalmente para cá, em vez de
// RTSP/streaming para um servidor de mídia dedicado. Cada chunk já
// commitado no disco (via VIDEO_CHUNK_STORAGE) não depende do restante da
// sessão — resiliente a queda de processo/rede no meio da gravação.
@Injectable()
export class VideoCaptureService {
  private readonly logger = new Logger(VideoCaptureService.name);

  constructor(
    @Inject(VIDEO_CAPTURE_SESSION_REPOSITORY) private readonly sessions: VideoCaptureSessionRepository,
    @Inject(VIDEO_CHUNK_STORAGE) private readonly storage: VideoChunkStorage,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly auditEvents: StockMovementAuditEventRepository,
  ) {}

  // Inicia a sessão de captura para um evento de auditoria — 1:1, chamado
  // quando o operador abre a tela de conferência e liga a câmera.
  // Idempotente por auditEventId: reabrir a tela (ex.: refresh acidental da
  // página) não cria uma segunda sessão, devolve a já existente.
  async startSession(tenantId: string, auditEventId: string): Promise<VideoCaptureSession> {
    const event = await this.auditEvents.findById(tenantId, auditEventId);
    if (!event) throw new NotFoundException(`Evento de auditoria ${auditEventId} não encontrado.`);

    const existing = await this.sessions.findByAuditEvent(tenantId, auditEventId);
    if (existing) return existing;

    const storageKey = `logistics-fulfillment/video-capture/${tenantId}/${auditEventId}.webm`;
    await this.storage.createSession(storageKey);
    return this.sessions.create({ tenantId, auditEventId, storageKey });
  }

  // Chunk incremental — nunca bufferiza o vídeo inteiro em memória, cada
  // chunk é gravado assim que chega (ver racional completo no port
  // VIDEO_CHUNK_STORAGE). canAcceptChunk decide ANTES de tocar disco:
  // idempotente para retransmissão (rede instável), rejeita lacuna ou
  // sessão já finalizada.
  async appendChunk(tenantId: string, sessionId: string, sequence: number, content: Buffer): Promise<VideoCaptureSession> {
    const session = await this.requireSession(tenantId, sessionId);

    const check = canAcceptChunk(session, sequence);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    if (check.isDuplicate) {
      // Retransmissão — já temos esse chunk no disco e no contador. Devolve
      // a sessão como está, sem duplicar nada (silenciosamente OK do ponto
      // de vista do cliente, que só precisa parar de reenviar).
      return session;
    }

    await this.storage.appendChunk(session.storageKey, content);
    return this.sessions.recordChunkReceived(session.id, content.length);
  }

  // Finaliza a captura — grava mediaUrl/mediaType no StockMovementAuditEvent
  // via o MESMO attachMedia do Hub de Provas (Sprint 24): canApprove
  // continua checando um único campo, sem precisar de uma segunda condição
  // de gate específica para vídeo.
  async finalize(tenantId: string, sessionId: string): Promise<VideoCaptureSession> {
    const session = await this.requireSession(tenantId, sessionId);

    const check = canFinalize(session);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const finalized = await this.sessions.finalize(session.id);
    // finalizeSession (não getPublicUrl) — no adapter R2 é aqui que o
    // CompleteMultipartUpload de fato acontece; getPublicUrl sozinho não
    // garante que o objeto já esteja legível no bucket (ver comentário na
    // porta VIDEO_CHUNK_STORAGE).
    const publicUrl = await this.storage.finalizeSession(session.storageKey);
    await this.auditEvents.attachMedia(session.auditEventId, publicUrl, 'VIDEO');

    return finalized;
  }

  getByAuditEvent(tenantId: string, auditEventId: string): Promise<VideoCaptureSession | null> {
    return this.sessions.findByAuditEvent(tenantId, auditEventId);
  }

  // Retenção de 30 dias (premissa de negócio nº 3) — chamado pelo job de
  // limpeza em background (VideoRetentionCleanupJob, @Cron diário). Apaga
  // só o ARQUIVO físico (bytes pesados); a linha de VideoCaptureSession
  // nunca é apagada — é o registro permanente de que a conferência visual
  // aconteceu. Uma sessão cujo delete falhe (storage indisponível) fica
  // para a próxima execução do job — findExpiredForCleanup encontra de
  // novo, porque videoDeletedAt só é marcado depois do delete ter sucesso.
  async runRetentionCleanup(now: Date = new Date()): Promise<{ deletedCount: number }> {
    const cutoff = new Date(now.getTime() - VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.sessions.findExpiredForCleanup(cutoff);

    let deletedCount = 0;
    for (const session of candidates) {
      if (!isExpiredForRetention(session, now)) continue; // defesa em profundidade — mesmo racional do piso redundante do PricingDecisionService
      try {
        await this.storage.delete(session.storageKey);
        await this.sessions.markVideoDeleted(session.id);
        deletedCount += 1;
      } catch (error) {
        this.logger.error(
          `Falha ao apagar vídeo da sessão ${session.id} (retenção de 30 dias): ${(error as Error).message}`,
        );
      }
    }

    if (deletedCount > 0) {
      this.logger.log(`Retenção de vídeo: ${deletedCount} arquivo(s) apagado(s) (30+ dias desde a finalização).`);
    }

    return { deletedCount };
  }

  private async requireSession(tenantId: string, sessionId: string): Promise<VideoCaptureSession> {
    const session = await this.sessions.findById(tenantId, sessionId);
    if (!session) throw new NotFoundException(`Sessão de captura ${sessionId} não encontrada.`);
    return session;
  }
}
