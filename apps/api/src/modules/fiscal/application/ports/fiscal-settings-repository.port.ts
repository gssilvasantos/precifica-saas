// FiscalSettings é um singleton por tenant (mesmo padrão de CatalogSettings)
// — daí findByTenant/upsert em vez de create/findById/update separados.
export interface FiscalSettingsRecord {
  tenantId: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  inscricaoEstadual: string;
  regimeTributario: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string | null;
  focusNfeTokenEnc: string;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  autoEmitOnApproval: boolean;
  nfeSerie: number | null;
  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026) — natureza usada quando EmitInvoiceInput.naturezaOperacaoId
  // não é informado no momento da emissão. Nullable: ausente = comportamento
  // histórico (resolveCfop hardcoded, Simples Nacional revenda simples).
  defaultNaturezaOperacaoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FiscalSettingsUpsertData = Omit<FiscalSettingsRecord, 'createdAt' | 'updatedAt'>;

export interface FiscalSettingsRepository {
  findByTenant(tenantId: string): Promise<FiscalSettingsRecord | null>;
  upsert(data: FiscalSettingsUpsertData): Promise<FiscalSettingsRecord>;
}

export const FISCAL_SETTINGS_REPOSITORY = Symbol('FISCAL_SETTINGS_REPOSITORY');
