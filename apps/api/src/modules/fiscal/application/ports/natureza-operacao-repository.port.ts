// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
// 29/07/2026, ver docs/naturezas-operacao-architecture.md) — cadastro
// próprio no schema fiscal, mesmo padrão de FiscalMarketplaceIntermediary
// (CRUD simples por tenant, não singleton como FiscalSettings).
export interface NaturezaOperacaoRecord {
  id: string;
  tenantId: string;
  nome: string;
  cfopVendaInterno: string;
  cfopVendaInterestadual: string;
  cfopDevolucaoInterno: string | null;
  cfopDevolucaoInterestadual: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NaturezaOperacaoCreateData = Omit<NaturezaOperacaoRecord, 'id' | 'createdAt' | 'updatedAt'>;

export type NaturezaOperacaoUpdateData = Partial<
  Omit<NaturezaOperacaoRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
>;

export interface NaturezaOperacaoRepository {
  create(data: NaturezaOperacaoCreateData): Promise<NaturezaOperacaoRecord>;
  findById(tenantId: string, id: string): Promise<NaturezaOperacaoRecord | null>;
  findByName(tenantId: string, nome: string): Promise<NaturezaOperacaoRecord | null>;
  findAllByTenant(tenantId: string): Promise<NaturezaOperacaoRecord[]>;
  update(id: string, data: NaturezaOperacaoUpdateData): Promise<NaturezaOperacaoRecord>;
}

export const NATUREZA_OPERACAO_REPOSITORY = Symbol('NATUREZA_OPERACAO_REPOSITORY');
