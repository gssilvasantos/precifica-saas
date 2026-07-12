import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoCaptureService } from './video-capture.service';
import { VideoCaptureSessionRepository } from './ports/video-capture-session-repository.port';
import { VideoChunkStorage } from './ports/video-chunk-storage.port';
import { StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { VideoCaptureSession } from '../domain/video-capture.entity';
import { StockMovementAuditEvent } from '../domain/stock-movement-audit-event.entity';

function buildSession(overrides: Partial<VideoCaptureSession> = {}): VideoCaptureSession {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    auditEventId: 'event-1',
    storageKey: 'logistics-fulfillment/video-capture/tenant-1/event-1.webm',
    status: 'RECORDING',
    receivedChunkCount: 0,
    totalBytes: 0,
    startedAt: new Date(),
    finalizedAt: null,
    videoDeletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildAuditEvent(overrides: Partial<StockMovementAuditEvent> = {}): StockMovementAuditEvent {
  return {
    id: 'event-1',
    tenantId: 'tenant-1',
    eventType: 'RETAIL_SHIPMENT',
    sourceWarehouseId: 'wh-physical',
    destinationWarehouseId: null,
    mediaUrl: null,
    mediaType: null,
    conferenceStatus: 'PENDENTE',
    conferredByUserId: null,
    conferredAt: null,
    divergenceNotes: null,
    invoiceNumber: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    orderIds: ['order-1'],
    ...overrides,
  };
}

describe('VideoCaptureService', () => {
  function buildService(session: VideoCaptureSession | null, auditEvent: StockMovementAuditEvent | null = buildAuditEvent()) {
    const sessions: jest.Mocked<VideoCaptureSessionRepository> = {
      create: jest.fn().mockResolvedValue(session ?? buildSession()),
      findById: jest.fn().mockResolvedValue(session),
      findByAuditEvent: jest.fn().mockResolvedValue(session),
      recordChunkReceived: jest.fn(),
      finalize: jest.fn(),
      markVideoDeleted: jest.fn(),
      findExpiredForCleanup: jest.fn().mockResolvedValue([]),
    };
    const storage: jest.Mocked<VideoChunkStorage> = {
      createSession: jest.fn(),
      appendChunk: jest.fn().mockResolvedValue({ totalBytes: 100 }),
      finalizeSession: jest.fn().mockResolvedValue('https://storage/video.webm'),
      getPublicUrl: jest.fn().mockReturnValue('https://storage/video.webm'),
      delete: jest.fn(),
    };
    const auditEvents: jest.Mocked<StockMovementAuditEventRepository> = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(auditEvent),
      findByOrderId: jest.fn(),
      attachMedia: jest.fn(),
      approveWithLedger: jest.fn(),
      markDivergent: jest.fn(),
      findPending: jest.fn().mockResolvedValue([]),
    };
    const service = new VideoCaptureService(sessions, storage, auditEvents);
    return { service, sessions, storage, auditEvents };
  }

  describe('startSession', () => {
    it('evento inexistente: lança NotFoundException', async () => {
      const { service } = buildService(null, null);
      await expect(service.startSession('tenant-1', 'event-1')).rejects.toThrow(NotFoundException);
    });

    it('idempotente: reabrir a tela devolve a sessão já existente, sem criar uma segunda', async () => {
      const existing = buildSession();
      const { service, sessions, storage } = buildService(existing);

      const result = await service.startSession('tenant-1', 'event-1');

      expect(result).toBe(existing);
      expect(sessions.create).not.toHaveBeenCalled();
      expect(storage.createSession).not.toHaveBeenCalled();
    });

    it('sem sessão prévia: cria o arquivo no storage e a linha da sessão', async () => {
      const { service, sessions, storage } = buildService(null);
      sessions.findByAuditEvent.mockResolvedValue(null);

      await service.startSession('tenant-1', 'event-1');

      expect(storage.createSession).toHaveBeenCalledWith('logistics-fulfillment/video-capture/tenant-1/event-1.webm');
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', auditEventId: 'event-1' }),
      );
    });
  });

  describe('appendChunk — idempotência e resiliência', () => {
    it('sessão inexistente: lança NotFoundException', async () => {
      const { service } = buildService(null);
      await expect(service.appendChunk('tenant-1', 'session-1', 0, Buffer.from('x'))).rejects.toThrow(NotFoundException);
    });

    it('chunk fora de ordem: rejeita e nunca escreve no storage', async () => {
      const { service, storage } = buildService(buildSession({ receivedChunkCount: 2 }));
      await expect(service.appendChunk('tenant-1', 'session-1', 5, Buffer.from('x'))).rejects.toThrow(BadRequestException);
      expect(storage.appendChunk).not.toHaveBeenCalled();
    });

    it('chunk retransmitido (duplicata): não escreve de novo no storage nem incrementa o contador', async () => {
      const { service, storage, sessions } = buildService(buildSession({ receivedChunkCount: 3 }));
      await service.appendChunk('tenant-1', 'session-1', 1, Buffer.from('x'));
      expect(storage.appendChunk).not.toHaveBeenCalled();
      expect(sessions.recordChunkReceived).not.toHaveBeenCalled();
    });

    it('chunk esperado: grava no storage e incrementa o contador com o tamanho do chunk', async () => {
      const { service, storage, sessions } = buildService(buildSession({ receivedChunkCount: 0 }));
      const chunk = Buffer.from('conteudo-do-chunk');

      await service.appendChunk('tenant-1', 'session-1', 0, chunk);

      expect(storage.appendChunk).toHaveBeenCalledWith('logistics-fulfillment/video-capture/tenant-1/event-1.webm', chunk);
      expect(sessions.recordChunkReceived).toHaveBeenCalledWith('session-1', chunk.length);
    });

    it('sessão já FINALIZED: rejeita novo chunk', async () => {
      const { service } = buildService(buildSession({ status: 'FINALIZED', receivedChunkCount: 5 }));
      await expect(service.appendChunk('tenant-1', 'session-1', 5, Buffer.from('x'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('finalize', () => {
    it('recusa finalizar uma captura vazia (nenhum chunk recebido)', async () => {
      const { service } = buildService(buildSession({ receivedChunkCount: 0 }));
      await expect(service.finalize('tenant-1', 'session-1')).rejects.toThrow(BadRequestException);
    });

    it('finaliza e grava mediaUrl/mediaType=VIDEO no StockMovementAuditEvent, reaproveitando attachMedia do Hub de Provas', async () => {
      const session = buildSession({ receivedChunkCount: 3 });
      const { service, sessions, auditEvents } = buildService(session);
      sessions.finalize.mockResolvedValue({ ...session, status: 'FINALIZED' });

      await service.finalize('tenant-1', 'session-1');

      expect(auditEvents.attachMedia).toHaveBeenCalledWith('event-1', 'https://storage/video.webm', 'VIDEO');
    });
  });

  describe('runRetentionCleanup — retenção de 30 dias', () => {
    it('sem sessões expiradas: não apaga nada', async () => {
      const { service, storage } = buildService(null);
      const result = await service.runRetentionCleanup(new Date());
      expect(result.deletedCount).toBe(0);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('apaga o arquivo físico e marca videoDeletedAt para cada sessão expirada', async () => {
      const now = new Date('2026-08-01T00:00:00Z');
      const expired = buildSession({
        id: 'session-old',
        status: 'FINALIZED',
        finalizedAt: new Date('2026-06-01T00:00:00Z'),
        receivedChunkCount: 5,
      });
      const { service, sessions, storage } = buildService(null);
      sessions.findExpiredForCleanup.mockResolvedValue([expired]);

      const result = await service.runRetentionCleanup(now);

      expect(storage.delete).toHaveBeenCalledWith(expired.storageKey);
      expect(sessions.markVideoDeleted).toHaveBeenCalledWith('session-old');
      expect(result.deletedCount).toBe(1);
    });

    it('uma falha ao apagar um arquivo não impede os demais de serem processados, e não marca videoDeletedAt', async () => {
      const now = new Date('2026-08-01T00:00:00Z');
      const expiredA = buildSession({ id: 'session-a', status: 'FINALIZED', finalizedAt: new Date('2026-06-01T00:00:00Z') });
      const expiredB = buildSession({ id: 'session-b', status: 'FINALIZED', finalizedAt: new Date('2026-06-01T00:00:00Z') });
      const { service, sessions, storage } = buildService(null);
      sessions.findExpiredForCleanup.mockResolvedValue([expiredA, expiredB]);
      storage.delete.mockRejectedValueOnce(new Error('disco indisponível')).mockResolvedValueOnce(undefined);

      const result = await service.runRetentionCleanup(now);

      expect(result.deletedCount).toBe(1);
      expect(sessions.markVideoDeleted).toHaveBeenCalledTimes(1);
      expect(sessions.markVideoDeleted).toHaveBeenCalledWith('session-b');
    });
  });
});
