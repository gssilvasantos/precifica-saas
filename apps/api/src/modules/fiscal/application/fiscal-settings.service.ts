import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CredentialEncryptionService } from '../../../shared/security/credential-encryption.service';
import {
  FISCAL_SETTINGS_REPOSITORY,
  FiscalSettingsRecord,
  FiscalSettingsRepository,
} from './ports/fiscal-settings-repository.port';
import { NaturezaOperacaoService } from './natureza-operacao.service';

export type SafeFiscalSettings = Omit<FiscalSettingsRecord, 'focusNfeTokenEnc'>;

export interface UpsertFiscalSettingsInput {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  inscricaoEstadual: string;
  regimeTributario?: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone?: string | null;
  // Só informado quando o token muda (primeira configuração ou rotação) —
  // se ausente numa atualização, o token criptografado já salvo é mantido.
  focusNfeToken?: string;
  environment?: 'HOMOLOGACAO' | 'PRODUCAO';
  autoEmitOnApproval?: boolean;
  nfeSerie?: number | null;
  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026) — undefined = não mexe no valor já salvo; null = remove a
  // natureza padrão explicitamente (volta ao fallback hardcoded).
  defaultNaturezaOperacaoId?: string | null;
}

// Configuração do emitente (Fase 3, benchmark Tiny ERP, Emissão de NF-e) —
// singleton por tenant, mesmo padrão de CatalogSettings. O token do Focus
// NFe NUNCA é devolvido pelo `get`/`upsert` (mesmo racional de qualquer
// credencial em repouso nesta base) — só FiscalInvoiceService, via
// `requireForEmission`, tem acesso ao valor decriptado, e só para montar a
// chamada HTTP.
@Injectable()
export class FiscalSettingsService {
  constructor(
    @Inject(FISCAL_SETTINGS_REPOSITORY) private readonly settings: FiscalSettingsRepository,
    private readonly credentials: CredentialEncryptionService,
    private readonly naturezasOperacao: NaturezaOperacaoService,
  ) {}

  async get(tenantId: string): Promise<SafeFiscalSettings | null> {
    const record = await this.settings.findByTenant(tenantId);
    return record ? this.omitToken(record) : null;
  }

  async upsert(tenantId: string, input: UpsertFiscalSettingsInput): Promise<SafeFiscalSettings> {
    this.assertRequiredFields(input);

    const existing = await this.settings.findByTenant(tenantId);
    const focusNfeTokenEnc = input.focusNfeToken ? this.credentials.encrypt(input.focusNfeToken) : existing?.focusNfeTokenEnc;
    if (!focusNfeTokenEnc) {
      throw new BadRequestException('focusNfeToken é obrigatório na primeira configuração fiscal deste tenant.');
    }

    // undefined = mantém o valor já salvo; null = remove explicitamente
    // (volta ao fallback hardcoded); string = valida que a natureza existe e
    // pertence a este tenant ANTES de gravar (nunca aponta pra um id
    // inexistente/de outro tenant).
    let defaultNaturezaOperacaoId = existing?.defaultNaturezaOperacaoId ?? null;
    if (input.defaultNaturezaOperacaoId !== undefined) {
      if (input.defaultNaturezaOperacaoId === null) {
        defaultNaturezaOperacaoId = null;
      } else {
        const natureza = await this.naturezasOperacao.findOne(tenantId, input.defaultNaturezaOperacaoId);
        defaultNaturezaOperacaoId = natureza.id;
      }
    }

    const record = await this.settings.upsert({
      tenantId,
      cnpj: input.cnpj.replace(/\D/g, ''),
      razaoSocial: input.razaoSocial,
      nomeFantasia: input.nomeFantasia ?? null,
      inscricaoEstadual: input.inscricaoEstadual,
      regimeTributario: input.regimeTributario ?? existing?.regimeTributario ?? 1,
      logradouro: input.logradouro,
      numero: input.numero,
      bairro: input.bairro,
      municipio: input.municipio,
      uf: input.uf.toUpperCase(),
      cep: input.cep.replace(/\D/g, ''),
      telefone: input.telefone ?? null,
      focusNfeTokenEnc,
      environment: input.environment ?? existing?.environment ?? 'HOMOLOGACAO',
      autoEmitOnApproval: input.autoEmitOnApproval ?? existing?.autoEmitOnApproval ?? false,
      nfeSerie: input.nfeSerie ?? existing?.nfeSerie ?? null,
      defaultNaturezaOperacaoId,
    });
    return this.omitToken(record);
  }

  // Uso interno (FiscalInvoiceService) — decripta o token só no momento de
  // montar a chamada HTTP, nunca antes disso. Lança BadRequestException (não
  // NotFoundException) porque a ausência de configuração é um erro de
  // operação do usuário ("configure antes de emitir"), não um recurso
  // inexistente na API.
  async requireForEmission(tenantId: string): Promise<{ record: FiscalSettingsRecord; token: string }> {
    const record = await this.settings.findByTenant(tenantId);
    if (!record) {
      throw new BadRequestException('Configure os dados fiscais do emitente (CNPJ, endereço, token Focus NFe) antes de emitir NF-e.');
    }
    return { record, token: this.credentials.decrypt(record.focusNfeTokenEnc) };
  }

  private omitToken(record: FiscalSettingsRecord): SafeFiscalSettings {
    const { focusNfeTokenEnc: _focusNfeTokenEnc, ...safe } = record;
    return safe;
  }

  private assertRequiredFields(input: UpsertFiscalSettingsInput): void {
    const required: [string, string | undefined][] = [
      ['cnpj', input.cnpj],
      ['razaoSocial', input.razaoSocial],
      ['inscricaoEstadual', input.inscricaoEstadual],
      ['logradouro', input.logradouro],
      ['numero', input.numero],
      ['bairro', input.bairro],
      ['municipio', input.municipio],
      ['uf', input.uf],
      ['cep', input.cep],
    ];
    for (const [field, value] of required) {
      if (!value || !value.trim()) {
        throw new BadRequestException(`${field} é obrigatório.`);
      }
    }
  }
}
