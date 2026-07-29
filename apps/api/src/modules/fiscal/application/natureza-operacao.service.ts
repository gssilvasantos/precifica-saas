import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  NATUREZA_OPERACAO_REPOSITORY,
  NaturezaOperacaoRecord,
  NaturezaOperacaoRepository,
} from './ports/natureza-operacao-repository.port';
import { isValidNaturezaOperacaoCfopConfig } from '../domain/tax-code-resolver';

export interface CreateNaturezaOperacaoInput {
  nome: string;
  cfopVendaInterno: string;
  cfopVendaInterestadual: string;
  cfopDevolucaoInterno?: string | null;
  cfopDevolucaoInterestadual?: string | null;
}

export type UpdateNaturezaOperacaoInput = Partial<CreateNaturezaOperacaoInput>;

// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
// 29/07/2026, ver docs/naturezas-operacao-architecture.md). CRUD de
// cadastro — nunca faz DELETE físico (só setActive, mesmo racional de
// VendedorService): uma natureza já usada numa emissão passada não pode
// desaparecer silenciosamente do histórico/auditoria.
//
// AVISO DE HONESTIDADE (mesmo racional de FiscalMarketplaceIntermediaryService):
// este serviço NUNCA valida se o CFOP informado é o "certo" para o cenário
// fiscal do tenant — só o FORMATO (4 dígitos). Quem decide o CFOP correto é
// o tenant/contador; o Kyneti só garante o formato e evita fabricar um
// código que não foi verificado.
@Injectable()
export class NaturezaOperacaoService {
  constructor(@Inject(NATUREZA_OPERACAO_REPOSITORY) private readonly repository: NaturezaOperacaoRepository) {}

  async create(tenantId: string, input: CreateNaturezaOperacaoInput): Promise<NaturezaOperacaoRecord> {
    const nome = input.nome.trim();
    if (!nome) {
      throw new BadRequestException('nome é obrigatório.');
    }

    const config = {
      cfopVendaInterno: input.cfopVendaInterno.trim(),
      cfopVendaInterestadual: input.cfopVendaInterestadual.trim(),
      cfopDevolucaoInterno: input.cfopDevolucaoInterno?.trim() ?? null,
      cfopDevolucaoInterestadual: input.cfopDevolucaoInterestadual?.trim() ?? null,
    };
    if (!isValidNaturezaOperacaoCfopConfig(config)) {
      throw new BadRequestException('Todo CFOP informado deve ter exatamente 4 dígitos numéricos.');
    }

    const existing = await this.repository.findByName(tenantId, nome);
    if (existing) {
      throw new BadRequestException(`Já existe uma Natureza de Operação chamada "${nome}" neste tenant.`);
    }

    return this.repository.create({ tenantId, nome, isActive: true, ...config });
  }

  async findAll(tenantId: string): Promise<NaturezaOperacaoRecord[]> {
    return this.repository.findAllByTenant(tenantId);
  }

  async findOne(tenantId: string, id: string): Promise<NaturezaOperacaoRecord> {
    const record = await this.repository.findById(tenantId, id);
    if (!record) {
      throw new NotFoundException(`Natureza de Operação ${id} não encontrada.`);
    }
    return record;
  }

  async update(tenantId: string, id: string, input: UpdateNaturezaOperacaoInput): Promise<NaturezaOperacaoRecord> {
    const current = await this.findOne(tenantId, id);

    const nome = input.nome?.trim() ?? current.nome;
    if (!nome) {
      throw new BadRequestException('nome é obrigatório.');
    }
    if (nome !== current.nome) {
      const existing = await this.repository.findByName(tenantId, nome);
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Já existe uma Natureza de Operação chamada "${nome}" neste tenant.`);
      }
    }

    const config = {
      cfopVendaInterno: input.cfopVendaInterno?.trim() ?? current.cfopVendaInterno,
      cfopVendaInterestadual: input.cfopVendaInterestadual?.trim() ?? current.cfopVendaInterestadual,
      cfopDevolucaoInterno:
        input.cfopDevolucaoInterno !== undefined ? (input.cfopDevolucaoInterno?.trim() ?? null) : current.cfopDevolucaoInterno,
      cfopDevolucaoInterestadual:
        input.cfopDevolucaoInterestadual !== undefined
          ? (input.cfopDevolucaoInterestadual?.trim() ?? null)
          : current.cfopDevolucaoInterestadual,
    };
    if (!isValidNaturezaOperacaoCfopConfig(config)) {
      throw new BadRequestException('Todo CFOP informado deve ter exatamente 4 dígitos numéricos.');
    }

    return this.repository.update(id, { nome, ...config });
  }

  async setActive(tenantId: string, id: string, isActive: boolean): Promise<NaturezaOperacaoRecord> {
    await this.findOne(tenantId, id);
    return this.repository.update(id, { isActive });
  }

  // Consumido por FiscalInvoiceService.emit — ausência (id inválido ou
  // pertencente a outro tenant) lança BadRequestException lá, nunca aqui
  // silenciosamente devolve outra natureza.
  async requireActiveForEmission(tenantId: string, id: string): Promise<NaturezaOperacaoRecord> {
    const record = await this.findOne(tenantId, id);
    if (!record.isActive) {
      throw new BadRequestException(`Natureza de Operação "${record.nome}" está inativa — ative-a antes de emitir com ela.`);
    }
    return record;
  }
}
