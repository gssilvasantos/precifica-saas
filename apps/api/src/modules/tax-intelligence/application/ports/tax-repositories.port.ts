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
  // Alíquota mantida à mão pelo lojista, em FRAÇÃO (convertida no repositório
  // como as demais). null = não sobrescrito, diferente de zero.
  aliquotaManual: number | null;
}

// Entrada de escrita (11/08/2026). Percentuais em 0–100, convenção do schema:
// a conversão para fração acontece no repositório, na mesma fronteira em que a
// leitura converte de volta. Ter as duas pontas no mesmo arquivo é o que
// impede as convenções de divergirem.
export interface NovoPerfilTributario {
  tenantId: string;
  uf: string;
  regime: TaxRegime;
  anexo: SimplesAnexo | null;
  vigenciaInicio: Date;
  meiValorFixoMensal: number | null;
  icmsAliquotaPct: number | null;
  presuncaoIrpjPct: number | null;
  presuncaoCsllPct: number | null;
  automationMode: 'AUTO' | 'MANUAL';
  // Alíquota mantida à mão, em PERCENTUAL (0–100) como os demais campos de
  // escrita. null = não sobrescrito, diferente de zero.
  aliquotaManualPct: number | null;
}

export interface TenantTaxProfileRepository {
  // O regime VIGENTE numa data — não "o regime atual". Um DRE de mês fechado
  // precisa do regime que valia naquele mês, não do de hoje.
  findVigente(tenantId: string, at: Date): Promise<TenantTaxProfileRecord | null>;

  // Histórico completo, mais recente primeiro. É o que permite ao contador ver
  // "era Simples até março, virou Presumido em abril" sem consultar o banco.
  listar(tenantId: string): Promise<TenantTaxProfileRecord[]>;

  // Mudança de regime NÃO sobrescreve o registro anterior: encerra a vigência
  // aberta na véspera do novo início e cria uma nova linha, numa transação.
  //
  // Sobrescrever destruiria a capacidade de recalcular um mês fechado com a
  // regra que valia nele — que é a razão de existir das colunas de vigência.
  // Ver o comentário de findVigente.
  abrirNovaVigencia(input: NovoPerfilTributario): Promise<TenantTaxProfileRecord>;
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

export interface NovoPerfilDeProduto {
  tenantId: string;
  productId: string;
  uf: string;
  icmsSt: boolean;
  monofasico: boolean;
  ncm: string | null;
  fonte: string;
  vigenciaInicio: Date;
}

export interface ProductTaxProfileRepository {
  // Chave (produto, UF, data): a ST é regime estadual e muda por portaria.
  // O mesmo SKU de cosmético estava em ST em SP até 31/03/2026 e deixou de
  // estar em 01/04/2026 (Portaria SRE 94/2025).
  findVigente(tenantId: string, productId: string, uf: string, at: Date): Promise<ProductTaxProfileRecord | null>;

  // Histórico do produto em TODAS as UFs, mais recente primeiro. É o que
  // permite ver "saiu da ST em SP em abril, continua em ST no PR".
  listarPorProduto(tenantId: string, productId: string): Promise<ProductTaxProfileRecord[]>;

  // Mesmo desenho temporal do perfil do tenant: encerra a vigência aberta
  // DAQUELA UF na véspera e abre uma nova. Por UF, não global — mudar a
  // classificação em SP não pode encerrar a do Paraná.
  abrirNovaVigencia(input: NovoPerfilDeProduto): Promise<ProductTaxProfileRecord>;
}

export const PRODUCT_TAX_PROFILE_REPOSITORY = Symbol('PRODUCT_TAX_PROFILE_REPOSITORY');

export interface PriorRevenueRecord {
  competencia: Date;
  receita: number; // mercado interno + externo
}

// Linha como o usuário informa e como a tela exibe: interno e externo
// separados. `findForPeriod` soma os dois porque o RBT12 é a receita bruta
// TOTAL — mas o cadastro precisa preservar a distinção, que existe por causa
// da regra de redução da exportação (art. 18, §14 da LC 123/2006).
export interface ReceitaAnteriorDetalhada {
  competencia: Date;
  receitaMercadoInterno: number;
  receitaMercadoExterno: number;
  fonte: string;
}

export interface TenantPriorRevenueRepository {
  findForPeriod(tenantId: string, from: Date, to: Date): Promise<PriorRevenueRecord[]>;

  listarDetalhado(tenantId: string, from: Date, to: Date): Promise<ReceitaAnteriorDetalhada[]>;

  // Idempotente por natureza: a unicidade (tenantId, competencia) já existe no
  // banco, então salvar a mesma competência duas vezes corrige em vez de
  // duplicar. É o que permite ao contador reenviar a planilha inteira depois
  // de ajustar um mês, sem limpar nada antes.
  salvarCompetencias(tenantId: string, linhas: ReceitaAnteriorDetalhada[]): Promise<void>;
}

export const TENANT_PRIOR_REVENUE_REPOSITORY = Symbol('TENANT_PRIOR_REVENUE_REPOSITORY');
