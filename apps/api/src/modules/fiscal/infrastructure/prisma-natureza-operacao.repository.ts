import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  NaturezaOperacaoCreateData,
  NaturezaOperacaoRecord,
  NaturezaOperacaoRepository,
  NaturezaOperacaoUpdateData,
} from '../application/ports/natureza-operacao-repository.port';

@Injectable()
export class PrismaNaturezaOperacaoRepository implements NaturezaOperacaoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NaturezaOperacaoCreateData): Promise<NaturezaOperacaoRecord> {
    const record = await this.prisma.naturezaOperacao.create({ data });
    return record as NaturezaOperacaoRecord;
  }

  async findById(tenantId: string, id: string): Promise<NaturezaOperacaoRecord | null> {
    const record = await this.prisma.naturezaOperacao.findFirst({ where: { id, tenantId } });
    return record as NaturezaOperacaoRecord | null;
  }

  async findByName(tenantId: string, nome: string): Promise<NaturezaOperacaoRecord | null> {
    const record = await this.prisma.naturezaOperacao.findFirst({ where: { tenantId, nome } });
    return record as NaturezaOperacaoRecord | null;
  }

  async findAllByTenant(tenantId: string): Promise<NaturezaOperacaoRecord[]> {
    const records = await this.prisma.naturezaOperacao.findMany({ where: { tenantId }, orderBy: { nome: 'asc' } });
    return records as NaturezaOperacaoRecord[];
  }

  async update(id: string, data: NaturezaOperacaoUpdateData): Promise<NaturezaOperacaoRecord> {
    const record = await this.prisma.naturezaOperacao.update({ where: { id }, data });
    return record as NaturezaOperacaoRecord;
  }
}
