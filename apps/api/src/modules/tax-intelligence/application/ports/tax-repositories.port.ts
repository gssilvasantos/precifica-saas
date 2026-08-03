// Portas de persistência do Tax Intelligence. Três repositórios pequenos em
// vez de um "TaxRepository" grande: cada um tem um consumidor e um ciclo de
// vida diferentes (regime muda uma vez por ano, perfil de produto muda por
// portaria, receita anterior é preenchida no onboarding).

import { SimplesAnexo } from '../../domain/simples-nacional';
import { TaxRegime } from '../../../../shared/contracts/tax-rate-resolver.port';

export interface TenantTaxProfileRecord {
  id: string;
  tenantId: string;
  uf: string;
  regime: TaxRegime;
  anexo: SimplesAnexo | null;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
  meiValorFixoMensal: number | null;
  // Regime normal (Presumido/Real) — frações, não percentuais: a conversão
  // acontece no repositório, na mesma fronteira em que o resto do sistema
  // converte (ver FinancialPolicyReader).
  icmsAliquota: number | null;
  presuncaoIrpj: number | null;
  presuncaoCsll: number | null;
  automationMode: 'AUTO' | 'MANUAL';
}

export interface TenantTaxProfileRepository {
  // O regime VIGENTE numa data — não "o regime atual". Um DRE de mês fechado
  // precisa do regime que valia naquele mês, não do de hoje.
  findVigente(tenantId: string, at: Date): Promise<TenantTaxProfileRecord | null>;
}

export const TENANT_TAX_PROFILE_REPOSITORY = Symbol('TENANT_TAX_PROFILE_REPOSITORY');

export interface ProductTaxProfileRecord {
  id: string;
  productId: string;
  uf: string;
  icmsSt: boolean;
  monofasico: boolean;
  ncm: string | null;
  fonte: string;
  vigenciaInicio: Date;
  vigenciaFim: Date | null;
}

export interface ProductTaxProfileRepository {
  // Chave (produto, UF, data): a ST é regime estadual e muda por portaria.
  // O mesmo SKU de cosmético estava em ST em SP até 31/03/2026 e deixou de
  // estar em 01/04/2026 (Portaria SRE 94/2025).
  findVigente(tenantId: string, productId: string, uf: string, at: Date): Promise<ProductTaxProfileRecord | null>;
}

export const PRODUCT_TAX_PROFILE_REPOSITORY = Symbol('PRODUCT_TAX_PROFILE_REPOSITORY');

export interface PriorRevenueRecord {
  competencia: Date;
  receita: number; // mercado interno + externo
}

export interface TenantPriorRevenueRepository {
  findForPeriod(tenantId: string, from: Date, to: Date): Promise<PriorRevenueRecord[]>;
}

export const TENANT_PRIOR_REVENUE_REPOSITORY = Symbol('TENANT_PRIOR_REVENUE_REPOSITORY');
