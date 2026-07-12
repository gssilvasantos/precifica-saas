import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { VideoCaptureSessionRepository } from '../application/ports/video-capture-session-repository.port';
import { VideoCaptureSession, VideoCaptureSessionCreateData, VideoCaptureStatus } from '../domain/video-capture.entity';

type RawSession = {
  id: string;
  tenantId: string;
  auditEventId: string;
  storageKey: string;
  status: string;
  receivedChunkCount: number;
  totalBytes: number;
  startedAt: Date;
  finalizedAt: Date | null;
  videoDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaVideoCaptureSessionRepository implements VideoCaptureSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: VideoCaptureSessionCreateData): Promise<VideoCaptureSession> {
    const record = await this.prisma.videoCaptureSession.create({
      data: {
        tenantId: data.tenantId,
        auditEventId: data.auditEventId,
        storageKey: data.storageKey,
      },
    });
    return this.toDomain(record as RawSession);
  }

  async findById(tenantId: string, id: string): Promise<VideoCaptureSession | null> {
    const record = await this.prisma.videoCaptureSession.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record as RawSession) : null;
  }

  async findByAuditEvent(tenantId: string, auditEventId: string): Promise<VideoCaptureSession | null> {
    const record = await this.prisma.videoCaptureSession.findFirst({ where: { tenantId, auditEventId } });
    return record ? this.toDomain(record as RawSession) : null;
  }

  // increment atômico de totalBytes + receivedChunkCount na mesma escrita —
  // mesmo racional do incrementScanned do checklist: nunca lê-modifica-escreve.
  async recordChunkReceived(id: string, chunkSize: number): Promise<VideoCaptureSession> {
    const record = await this.prisma.videoCaptureSession.update({
      where: { id },
      data: {
        receivedChunkCount: { increment: 1 },
        totalBytes: { increment: chunkSize },
      },
    });
    return this.toDomain(record as RawSession);
  }

  async finalize(id: string): Promise<VideoCaptureSession> {
    const record = await this.prisma.videoCaptureSession.update({
      where: { id },
      data: { status: 'FINALIZED', finalizedAt: new Date() },
    });
    return this.toDomain(record as RawSession);
  }

  async markVideoDeleted(id: string): Promise<VideoCaptureSession> {
    const record = await this.prisma.videoCaptureSession.update({
      where: { id },
      data: { videoDeletedAt: new Date() },
    });
    return this.toDomain(record as RawSession);
  }

  // Candidatos à limpeza de retenção: FINALIZED, ainda não apagados, e
  // finalizados antes do corte — o job (VideoCaptureService.runRetentionCleanup)
  // ainda reconfere isExpiredForRetention linha a linha (defesa em profundidade).
  findExpiredForCleanup(cutoff: Date): Promise<VideoCaptureSession[]> {
    return this.prisma.videoCaptureSession
      .findMany({
        where: { status: 'FINALIZED', videoDeletedAt: null, finalizedAt: { lte: cutoff } },
      })
      .then((records) => records.map((r) => this.toDomain(r as RawSession)));
  }

  private toDomain(record: RawSession): VideoCaptureSession {
    return {
      id: record.id,
      tenantId: record.tenantId,
      auditEventId: record.auditEventId,
      storageKey: record.storageKey,
      status: record.status as VideoCaptureStatus,
      receivedChunkCount: record.receivedChunkCount,
      totalBytes: record.totalBytes,
      startedAt: record.startedAt,
      finalizedAt: record.finalizedAt,
      videoDeletedAt: record.videoDeletedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
