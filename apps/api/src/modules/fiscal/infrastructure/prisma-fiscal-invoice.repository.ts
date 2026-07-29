import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { FiscalInvoiceRepository } from '../application/ports/fiscal-invoice-repository.port';
import {
  FiscalAddress,
  FiscalAuthorizationResult,
  FiscalErrorResult,
  FiscalInvoice,
  FiscalInvoiceCreateData,
} from '../domain/fiscal-invoice.entity';

type PrismaFiscalInvoiceRecord = {
  id: string;
  tenantId: string;
  orderId: string;
  focusRef: string;
  status: string;
  environment: string;
  destNome: string;
  destDocumento: string;
  destEndereco: unknown;
  destTelefone: string | null;
  nfeNumber: string | null;
  nfeSeries: string | null;
  accessKey: string | null;
  xmlUrl: string | null;
  danfeUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancelReason: string | null;
  requestedAt: Date;
  authorizedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PrismaFiscalInvoiceRepository implements FiscalInvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: FiscalInvoiceCreateData): Promise<FiscalInvoice> {
    const record = await this.prisma.fiscalInvoice.create({
      data: {
        tenantId: data.tenantId,
        orderId: data.orderId,
        focusRef: data.focusRef,
        environment: data.environment as never,
        destNome: data.destNome,
        destDocumento: data.destDocumento,
        destEndereco: data.destEndereco as never,
        destTelefone: data.destTelefone ?? null,
      },
    });
    return this.toDomain(record as never);
  }

  async findById(tenantId: string, id: string): Promise<FiscalInvoice | null> {
    const record = await this.prisma.fiscalInvoice.findFirst({ where: { id, tenantId } });
    return record ? this.toDomain(record as never) : null;
  }

  async findByFocusRef(focusRef: string): Promise<FiscalInvoice | null> {
    const record = await this.prisma.fiscalInvoice.findUnique({ where: { focusRef } });
    return record ? this.toDomain(record as never) : null;
  }

  async findAllByOrder(tenantId: string, orderId: string): Promise<FiscalInvoice[]> {
    const records = await this.prisma.fiscalInvoice.findMany({
      where: { tenantId, orderId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r as never));
  }

  async findAllByTenant(tenantId: string, status?: string): Promise<FiscalInvoice[]> {
    const records = await this.prisma.fiscalInvoice.findMany({
      where: { tenantId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.toDomain(r as never));
  }

  async markProcessing(id: string): Promise<FiscalInvoice> {
    const record = await this.prisma.fiscalInvoice.update({ where: { id }, data: { status: 'PROCESSANDO' as never } });
    return this.toDomain(record as never);
  }

  async markAuthorized(id: string, result: FiscalAuthorizationResult): Promise<FiscalInvoice> {
    const record = await this.prisma.fiscalInvoice.update({
      where: { id },
      data: {
        status: 'AUTORIZADA' as never,
        nfeNumber: result.nfeNumber,
        nfeSeries: result.nfeSeries,
        accessKey: result.accessKey,
        xmlUrl: result.xmlUrl,
        danfeUrl: result.danfeUrl,
        authorizedAt: new Date(),
      },
    });
    return this.toDomain(record as never);
  }

  async markError(id: string, result: FiscalErrorResult): Promise<FiscalInvoice> {
    const record = await this.prisma.fiscalInvoice.update({
      where: { id },
      data: { status: 'ERRO' as never, errorCode: result.errorCode, errorMessage: result.errorMessage },
    });
    return this.toDomain(record as never);
  }

  async markCancelled(id: string, cancelReason: string): Promise<FiscalInvoice> {
    const record = await this.prisma.fiscalInvoice.update({
      where: { id },
      data: { status: 'CANCELADA' as never, cancelReason, cancelledAt: new Date() },
    });
    return this.toDomain(record as never);
  }

  private toDomain(record: PrismaFiscalInvoiceRecord): FiscalInvoice {
    return {
      id: record.id,
      tenantId: record.tenantId,
      orderId: record.orderId,
      focusRef: record.focusRef,
      status: record.status as FiscalInvoice['status'],
      environment: record.environment as FiscalInvoice['environment'],
      destNome: record.destNome,
      destDocumento: record.destDocumento,
      destEndereco: record.destEndereco as FiscalAddress,
      destTelefone: record.destTelefone,
      nfeNumber: record.nfeNumber,
      nfeSeries: record.nfeSeries,
      accessKey: record.accessKey,
      xmlUrl: record.xmlUrl,
      danfeUrl: record.danfeUrl,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      cancelReason: record.cancelReason,
      requestedAt: record.requestedAt,
      authorizedAt: record.authorizedAt,
      cancelledAt: record.cancelledAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
