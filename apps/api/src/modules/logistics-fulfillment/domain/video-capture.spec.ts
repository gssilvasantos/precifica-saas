import { canAcceptChunk, canFinalize, isExpiredForRetention, VideoCaptureSession, VIDEO_RETENTION_DAYS } from './video-capture.entity';

function buildSession(overrides: Partial<VideoCaptureSession> = {}): VideoCaptureSession {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    auditEventId: 'event-1',
    storageKey: 'logistics-fulfillment/video/event-1.webm',
    status: 'RECORDING',
    receivedChunkCount: 0,
    totalBytes: 0,
    startedAt: new Date('2026-07-01T10:00:00Z'),
    finalizedAt: null,
    videoDeletedAt: null,
    createdAt: new Date('2026-07-01T10:00:00Z'),
    updatedAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

describe('canAcceptChunk — idempotência de upload de chunk', () => {
  it('aceita o próximo chunk esperado (sequence === receivedChunkCount)', () => {
    const result = canAcceptChunk(buildSession({ receivedChunkCount: 3 }), 3);
    expect(result.ok).toBe(true);
    expect(result.isDuplicate).toBe(false);
  });

  it('aceita uma retransmissão (sequence < receivedChunkCount) sem marcar erro, sinalizando duplicata', () => {
    const result = canAcceptChunk(buildSession({ receivedChunkCount: 3 }), 1);
    expect(result.ok).toBe(true);
    expect(result.isDuplicate).toBe(true);
  });

  it('rejeita chunk fora de ordem (lacuna — sequence > receivedChunkCount)', () => {
    const result = canAcceptChunk(buildSession({ receivedChunkCount: 3 }), 5);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fora de ordem/i);
  });

  it('rejeita sequence negativo ou não inteiro', () => {
    expect(canAcceptChunk(buildSession(), -1).ok).toBe(false);
    expect(canAcceptChunk(buildSession(), 1.5).ok).toBe(false);
  });

  it('rejeita qualquer chunk numa sessão já FINALIZED', () => {
    const result = canAcceptChunk(buildSession({ status: 'FINALIZED', receivedChunkCount: 10 }), 10);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/FINALIZED/);
  });
});

describe('canFinalize', () => {
  it('recusa finalizar uma captura vazia (nenhum chunk recebido)', () => {
    const result = canFinalize(buildSession({ receivedChunkCount: 0 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/vazia/i);
  });

  it('permite finalizar com ao menos um chunk recebido', () => {
    const result = canFinalize(buildSession({ receivedChunkCount: 1 }));
    expect(result.ok).toBe(true);
  });

  it('recusa finalizar uma sessão que já está FINALIZED', () => {
    const result = canFinalize(buildSession({ status: 'FINALIZED', receivedChunkCount: 5 }));
    expect(result.ok).toBe(false);
  });
});

describe('isExpiredForRetention — retenção de 30 dias', () => {
  it('nunca expira uma sessão ainda RECORDING (não finalizada)', () => {
    const now = new Date('2026-09-01T00:00:00Z');
    expect(isExpiredForRetention(buildSession({ status: 'RECORDING', finalizedAt: null }), now)).toBe(false);
  });

  it('não expira antes de completar os 30 dias', () => {
    const finalizedAt = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-20T00:00:00Z'); // 19 dias depois
    expect(isExpiredForRetention(buildSession({ status: 'FINALIZED', finalizedAt }), now)).toBe(false);
  });

  it('expira exatamente aos 30 dias completos', () => {
    const finalizedAt = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-31T00:00:00Z'); // exatamente 30 dias
    expect(isExpiredForRetention(buildSession({ status: 'FINALIZED', finalizedAt }), now)).toBe(true);
  });

  it('nunca reprocessa uma sessão cujo vídeo já foi apagado (idempotente)', () => {
    const finalizedAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-12-01T00:00:00Z');
    const videoDeletedAt = new Date('2026-02-01T00:00:00Z');
    expect(isExpiredForRetention(buildSession({ status: 'FINALIZED', finalizedAt, videoDeletedAt }), now)).toBe(false);
  });

  it('respeita um retentionDays customizado', () => {
    const finalizedAt = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-11T00:00:00Z'); // 10 dias depois
    expect(isExpiredForRetention(buildSession({ status: 'FINALIZED', finalizedAt }), now, 10)).toBe(true);
    expect(VIDEO_RETENTION_DAYS).toBe(30);
  });
});
