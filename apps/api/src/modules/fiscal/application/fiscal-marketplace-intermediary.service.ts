import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY,
  FiscalMarketplaceIntermediaryRecord,
  FiscalMarketplaceIntermediaryRepository,
} from './ports/fiscal-marketplace-intermediary-repository.port';

export interface UpsertFiscalMarketplaceIntermediaryInput {
  channelCode: string;
  cnpj: string;
  idCadIntTran: string;
}

// Grupo G da NF-e (NT 2020.006) — benchmark Bling, 29/07/2026 (ver
// docs/bling-erp-benchmark-analysis.md, seção 1.4). CRUD simples por canal,
// mesmo padrão de FreightProviderConnectionService (uma linha por
// tenant+provider/canal, não um singleton por tenant como FiscalSettings).
//
// AVISO DE HONESTIDADE: este serviço NUNCA pré-preenche um CNPJ de
// marketplace — o tenant (ou seu contador) informa o valor conscientemente.
// Ver comentário completo no schema.prisma (model FiscalMarketplaceIntermediary).
@Injectable()
export class FiscalMarketplaceIntermediaryService {
  constructor(
    @Inject(FISCAL_MARKETPLACE_INTERMEDIARY_REPOSITORY) private readonly repository: FiscalMarketplaceIntermediaryRepository,
  ) {}

  async listForTenant(tenantId: string): Promise<FiscalMarketplaceIntermediaryRecord[]> {
    return this.repository.findAllByTenant(tenantId);
  }

  async upsert(tenantId: string, input: UpsertFiscalMarketplaceIntermediaryInput): Promise<FiscalMarketplaceIntermediaryRecord> {
    const channelCode = input.channelCode.trim().toUpperCase();
    const cnpj = input.cnpj.replace(/\D/g, '');
    const idCadIntTran = input.idCadIntTran.trim();
    if (!channelCode) {
      throw new BadRequestException('channelCode é obrigatório.');
    }
    if (cnpj.length !== 14) {
      throw new BadRequestException('cnpj deve ter 14 dígitos (CNPJ do intermediador/marketplace, nunca do vendedor).');
    }
    if (!idCadIntTran) {
      throw new BadRequestException('idCadIntTran é obrigatório — identificador do SEU cadastro de vendedor naquela plataforma.');
    }
    return this.repository.upsert({ tenantId, channelCode, cnpj, idCadIntTran });
  }

  async remove(tenantId: string, channelCode: string): Promise<void> {
    await this.repository.remove(tenantId, channelCode.trim().toUpperCase());
  }

  // Consumido por FiscalInvoiceService.emit — ausência é um caso válido
  // (canal sem intermediador configurado, ex.: Nuvemshop, ou tenant ainda não
  // configurou), nunca lança.
  async findForChannel(tenantId: string, channelCode: string): Promise<FiscalMarketplaceIntermediaryRecord | null> {
    return this.repository.findByTenantAndChannel(tenantId, channelCode.toUpperCase());
  }
}
