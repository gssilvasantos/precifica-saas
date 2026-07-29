// Códigos de tributação — MVP com defaults de Simples Nacional (decisão do
// usuário, 28/07/2026, ver docs/fiscal-nfe-architecture.md). O Kyneti hoje
// só tem um percentual ESTIMADO de imposto por TaxProfile
// (catalog/domain/tax-profile.entity.ts) — não tem CFOP nem CST de
// ICMS/PIS/COFINS configuráveis por produto/perfil, que a SEFAZ exige por
// item de NF-e. Em vez de modelar isso agora (trabalho de construção maior,
// adiado — ver gap conhecido na doc de arquitetura), este módulo assume que
// TODO tenant emitindo pela integração é Simples Nacional e aplica os
// códigos padrão abaixo a QUALQUER item. Isso é suficiente para o caso mais
// comum (revenda simples, sem substituição tributária, sem ICMS
// diferenciado) — cenários fora disso (ST, produtos com tributação
// específica) exigem revisão do contador ANTES de emitir, ou a promoção
// futura destes campos para configuráveis por TaxProfile.

// CST do ICMS — "102: Tributada pelo Simples Nacional sem permissão de
// crédito" é o código mais comum para revenda no Simples Nacional.
export const ICMS_SITUACAO_TRIBUTARIA_DEFAULT = '102';

// CST do PIS/COFINS — "07: Operação isenta da contribuição" é o default
// usado nos próprios exemplos oficiais da documentação Focus NFe para
// operações simples.
export const PIS_SITUACAO_TRIBUTARIA_DEFAULT = '07';
export const COFINS_SITUACAO_TRIBUTARIA_DEFAULT = '07';

// Origem do ICMS — "0: Nacional" é o fallback SÓ quando o produto não
// declara a própria origem (Product.fiscalOriginCode, Fase 0 do benchmark,
// já existe e deve ser preferido sempre que presente).
export const ICMS_ORIGEM_FALLBACK = 0;

// CFOP de venda — 5.102 (operação DENTRO do mesmo estado do emitente) ou
// 6.102 (operação para OUTRO estado) são os códigos padrão de "venda de
// mercadoria adquirida ou recebida de terceiros" fora do Simples Nacional
// com substituição tributária. Cobre o caso comum de revenda multicanal;
// não cobre remessa ou operações com substituição tributária (que
// exigiriam CFOPs 5.405/6.108 etc. — fora do escopo do MVP). Devolução
// (ver `NfeFinalidade` abaixo) já é coberta — ver `resolveCfop`.
const CFOP_VENDA_INTERNA = '5102';
const CFOP_VENDA_INTERESTADUAL = '6102';

// Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md, seção
// 2 — `NotasFiscaisDadosPostDTO.finalidade`) — finalidade de emissão da
// NF-e. Valores e significado confirmados diretamente na documentação
// oficial da Focus NFe (`finalidade_emissao`, doc.focusnfe.com.br/reference/
// emitir_nfe, consultada em 29/07/2026): só aceita 1/2/3/4. O benchmark
// Bling também cita 5 (Crédito) e 6 (Débito), mas a Focus NFe — o parceiro
// fiscal efetivamente integrado pelo Kyneti (ver docs/fiscal-nfe-architecture.md)
// — não expõe esses dois no endpoint de emissão; por isso ficam de fora
// deste MVP (nunca fabricados sem confirmação).
export type NfeFinalidade = 'NORMAL' | 'COMPLEMENTAR' | 'AJUSTE' | 'DEVOLUCAO';

const NFE_FINALIDADE_CODE: Record<NfeFinalidade, number> = {
  NORMAL: 1,
  COMPLEMENTAR: 2,
  AJUSTE: 3,
  DEVOLUCAO: 4,
};

export function resolveNfeFinalidadeCode(finalidade: NfeFinalidade): number {
  return NFE_FINALIDADE_CODE[finalidade];
}

// Toda finalidade que NÃO é Normal exige, por regra da SEFAZ, que a NF-e
// referencie o documento fiscal de origem (a nota que está sendo
// complementada/ajustada/devolvida) — ver grupo `nfRef`/`notas_referenciadas`
// no payload (nfe-payload-builder.ts). Validado aqui (função pura) para o
// FiscalInvoiceService rejeitar ANTES de gastar uma chamada à Focus NFe com
// um payload que a SEFAZ rejeitaria de qualquer forma.
export function requiresReferencedDocument(finalidade: NfeFinalidade): boolean {
  return finalidade !== 'NORMAL';
}

export function isValidReferencedDocuments(finalidade: NfeFinalidade, documentoReferenciado: string[] | undefined): boolean {
  if (!requiresReferencedDocument(finalidade)) return true;
  if (!documentoReferenciado || documentoReferenciado.length === 0) return false;
  // Chave de acesso da NF-e: sempre 44 dígitos numéricos (padrão nacional
  // SEFAZ, não específico de nenhum parceiro fiscal).
  return documentoReferenciado.every((chave) => /^\d{44}$/.test(chave));
}

// CFOP de devolução — 5.202/6.202 ("devolução de venda de mercadoria
// adquirida ou recebida de terceiros"), par natural de 5.102/6.102 acima.
// Exportado (não só interno de resolveCfop) porque resolveCfopFromNatureza
// usa exatamente estes valores como fallback quando uma Natureza de Operação
// customizada não define seu próprio CFOP de devolução — ver Projeto
// Estruturante 4, docs/naturezas-operacao-architecture.md.
export const CFOP_DEVOLUCAO_INTERNA_DEFAULT = '5202';
export const CFOP_DEVOLUCAO_INTERESTADUAL_DEFAULT = '6202';

// CFOP — Devolução (finalidade DEVOLUCAO) usa os códigos de "devolução de
// venda de mercadoria adquirida ou recebida de terceiros" (5.202 interna /
// 6.202 interestadual, mesma lógica de estado emitente x destinatário da
// venda normal). Complementar/Ajuste mantêm o CFOP da operação original
// (a nota complementar/de ajuste referencia, mas não desfaz, a venda) —
// por isso só DEVOLUCAO muda o resultado abaixo.
export function resolveCfop(ufEmitente: string, ufDestinatario: string, finalidade: NfeFinalidade = 'NORMAL'): string {
  const sameState = ufEmitente.trim().toUpperCase() === ufDestinatario.trim().toUpperCase();
  if (finalidade === 'DEVOLUCAO') {
    return sameState ? CFOP_DEVOLUCAO_INTERNA_DEFAULT : CFOP_DEVOLUCAO_INTERESTADUAL_DEFAULT;
  }
  return sameState ? CFOP_VENDA_INTERNA : CFOP_VENDA_INTERESTADUAL;
}

// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
// 29/07/2026 — ver docs/bling-erp-benchmark-analysis.md, seção 2,
// `NaturezasOperacoesDadosDTO`, e docs/naturezas-operacao-architecture.md).
// Generaliza resolveCfop: em vez de um único CFOP de venda hardcoded
// (Simples Nacional revenda simples), qualquer NaturezaOperacao cadastrada
// pelo tenant pode fornecer o seu próprio CFOP de venda por
// interno/interestadual. CFOP de devolução continua opcional na natureza —
// quando ausente, cai no MESMO fallback hardcoded de resolveCfop
// (CFOP_DEVOLUCAO_INTERNA_DEFAULT/CFOP_DEVOLUCAO_INTERESTADUAL_DEFAULT),
// nunca um valor "adivinhado" a partir do CFOP de venda customizado (a
// correspondência venda->devolução não é uma fórmula universal para
// qualquer CFOP — depende do regime/cenário, e o Kyneti nunca fabrica um
// código fiscal que não verificou).
export interface NaturezaOperacaoCfopConfig {
  cfopVendaInterno: string;
  cfopVendaInterestadual: string;
  cfopDevolucaoInterno?: string | null;
  cfopDevolucaoInterestadual?: string | null;
}

export function resolveCfopFromNatureza(
  config: NaturezaOperacaoCfopConfig,
  ufEmitente: string,
  ufDestinatario: string,
  finalidade: NfeFinalidade = 'NORMAL',
): string {
  const sameState = ufEmitente.trim().toUpperCase() === ufDestinatario.trim().toUpperCase();
  if (finalidade === 'DEVOLUCAO') {
    const interno = config.cfopDevolucaoInterno ?? CFOP_DEVOLUCAO_INTERNA_DEFAULT;
    const interestadual = config.cfopDevolucaoInterestadual ?? CFOP_DEVOLUCAO_INTERESTADUAL_DEFAULT;
    return sameState ? interno : interestadual;
  }
  return sameState ? config.cfopVendaInterno : config.cfopVendaInterestadual;
}

// CFOP é sempre numérico com 4 dígitos (padrão nacional SEFAZ) — validado
// aqui (função pura) para NaturezaOperacaoService rejeitar um cadastro
// obviamente errado ANTES de persistir, mesmo que o valor exato dependa do
// cenário fiscal do tenant (que o Kyneti não valida semanticamente, só o
// formato).
export function isValidCfopCode(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}

export function isValidNaturezaOperacaoCfopConfig(config: NaturezaOperacaoCfopConfig): boolean {
  if (!isValidCfopCode(config.cfopVendaInterno) || !isValidCfopCode(config.cfopVendaInterestadual)) {
    return false;
  }
  if (config.cfopDevolucaoInterno != null && !isValidCfopCode(config.cfopDevolucaoInterno)) {
    return false;
  }
  if (config.cfopDevolucaoInterestadual != null && !isValidCfopCode(config.cfopDevolucaoInterestadual)) {
    return false;
  }
  return true;
}
