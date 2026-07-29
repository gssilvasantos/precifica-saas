import { FiscalAddress } from './fiscal-invoice.entity';
import {
  COFINS_SITUACAO_TRIBUTARIA_DEFAULT,
  ICMS_ORIGEM_FALLBACK,
  ICMS_SITUACAO_TRIBUTARIA_DEFAULT,
  NaturezaOperacaoCfopConfig,
  NfeFinalidade,
  PIS_SITUACAO_TRIBUTARIA_DEFAULT,
  resolveCfop,
  resolveCfopFromNatureza,
  resolveNfeFinalidadeCode,
} from './tax-code-resolver';

// Função PURA que monta o corpo JSON esperado por `POST /v2/nfe` da Focus
// NFe (ver docs/fiscal-nfe-architecture.md) a partir de dados já resolvidos
// pelo chamador (FiscalInvoiceService) — este módulo não sabe de onde vêm
// FiscalSettings/Order/Product, só sabe montar o payload. Mesma disciplina
// de domain puro do resto desta base (packaging/resolveShippingDimensions,
// price-list/resolveListPrice etc.).

export interface NfePayloadEmitenteInput {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string | null;
  inscricaoEstadual: string;
  regimeTributario: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
}

export interface NfePayloadDestinatarioInput {
  nome: string;
  documento: string; // CPF ou CNPJ, com ou sem máscara — normalizado aqui
  endereco: FiscalAddress;
  telefone?: string | null;
}

export interface NfePayloadItemInput {
  numeroItem: number;
  codigoProduto: string; // skuCode
  descricao: string;
  ncm: string;
  icmsOrigem: number | null; // null -> ICMS_ORIGEM_FALLBACK
  quantidade: number;
  valorUnitario: number;
  valorBruto: number;
  // CEST (benchmark Bling, docs/bling-erp-benchmark-analysis.md, seção 2) —
  // obrigatório quando o item sofre Substituição Tributária (ICMS-ST). null
  // = produto sem ST, campo omitido do payload (não enviado como vazio).
  cest?: string | null;
}

// Grupo G da NF-e ("Identificação do Intermediador da Transação", NT
// 2020.006) — benchmark Bling, 29/07/2026 (ver
// docs/bling-erp-benchmark-analysis.md, seção 1.4). cnpj é da PLATAFORMA
// (Mercado Livre, Shopee etc.), idCadIntTran é o identificador do PRÓPRIO
// vendedor cadastrado naquela plataforma — nunca um valor global do canal.
export interface NfePayloadIntermediadorInput {
  cnpj: string;
  idCadIntTran: string;
}

export interface NfePayloadInput {
  naturezaOperacao: string;
  dataEmissao: Date;
  emitente: NfePayloadEmitenteInput;
  destinatario: NfePayloadDestinatarioInput;
  items: NfePayloadItemInput[];
  valorFrete?: number;
  valorDesconto?: number;
  // Ausente = venda sem intermediador (ex.: Nuvemshop, loja própria) —
  // indicador_intermediario vai 0. Presente = venda via marketplace de
  // terceiros — indicador_intermediario vai 1 e o Grupo G é enviado.
  intermediador?: NfePayloadIntermediadorInput;
  // Quick Win 7 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2) — finalidade da emissão. Omitido = NORMAL (comportamento de
  // antes deste quick win). Complementar/Ajuste/Devolução exigem
  // documentoReferenciado (validado em FiscalInvoiceService.emit via
  // isValidReferencedDocuments, ANTES de chegar aqui).
  finalidade?: NfeFinalidade;
  // Chaves de acesso (44 dígitos) das notas de origem sendo
  // complementadas/ajustadas/devolvidas — sempre um array, mesmo quando só
  // uma nota é referenciada (mesmo racional plural de
  // `documentosReferenciados` no benchmark Bling).
  documentoReferenciado?: string[];
  // Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP,
  // 29/07/2026, ver docs/naturezas-operacao-architecture.md) — ausente
  // (comportamento histórico) usa resolveCfop hardcoded (Simples Nacional
  // revenda simples). Presente = usa o CFOP configurado na
  // NaturezaOperacao selecionada pelo chamador (FiscalInvoiceService), via
  // resolveCfopFromNatureza.
  cfopConfig?: NaturezaOperacaoCfopConfig;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Item sem NCM não pode virar linha de NF-e — validado ANTES de chamar
// buildNfePayload (ver FiscalInvoiceService.emit), nunca silenciosamente
// substituído por um valor default (NCM errado é pior que bloquear a
// emissão e pedir pro lojista cadastrar o campo no produto).
export function hasRequiredItemFields(items: Pick<NfePayloadItemInput, 'ncm'>[]): boolean {
  return items.length > 0 && items.every((item) => !!item.ncm && item.ncm.trim().length > 0);
}

export function buildNfePayload(input: NfePayloadInput): Record<string, unknown> {
  const finalidade = input.finalidade ?? 'NORMAL';
  const cfop = input.cfopConfig
    ? resolveCfopFromNatureza(input.cfopConfig, input.emitente.uf, input.destinatario.endereco.uf, finalidade)
    : resolveCfop(input.emitente.uf, input.destinatario.endereco.uf, finalidade);
  const documentoDigits = onlyDigits(input.destinatario.documento);
  const isCpf = documentoDigits.length === 11;

  const valorProdutos = round2(input.items.reduce((sum, item) => sum + item.valorBruto, 0));
  const valorFrete = round2(input.valorFrete ?? 0);
  const valorDesconto = round2(input.valorDesconto ?? 0);
  const valorTotal = round2(valorProdutos + valorFrete - valorDesconto);

  return {
    natureza_operacao: input.naturezaOperacao,
    data_emissao: input.dataEmissao.toISOString(),
    tipo_documento: 1, // Nota Fiscal de Saída — Kyneti só emite para vendas
    finalidade_emissao: resolveNfeFinalidadeCode(finalidade),
    // notas_referenciadas — nome de campo confirmado via documentação
    // pública da Focus NFe (community/TagPlus, não a referência oficial
    // completa campos.focusnfe.com.br, que não pôde ser inspecionada campo
    // a campo nesta sessão) — AVISO DE HONESTIDADE, mesmo padrão do resto
    // deste client: revisar contra a doc oficial antes do primeiro uso em
    // produção de finalidade != Normal.
    ...(input.documentoReferenciado && input.documentoReferenciado.length > 0
      ? { notas_referenciadas: input.documentoReferenciado.map((chave) => ({ chave_nfe: chave })) }
      : {}),
    consumidor_final: 1,
    presenca_comprador: 2, // Operação não presencial, pela Internet — perfil e-commerce/marketplace
    cnpj_emitente: onlyDigits(input.emitente.cnpj),
    nome_emitente: input.emitente.razaoSocial,
    ...(input.emitente.nomeFantasia ? { nome_fantasia_emitente: input.emitente.nomeFantasia } : {}),
    logradouro_emitente: input.emitente.logradouro,
    numero_emitente: input.emitente.numero,
    bairro_emitente: input.emitente.bairro,
    municipio_emitente: input.emitente.municipio,
    uf_emitente: input.emitente.uf,
    cep_emitente: onlyDigits(input.emitente.cep),
    inscricao_estadual_emitente: input.emitente.inscricaoEstadual,
    regime_tributario_emitente: input.emitente.regimeTributario,
    nome_destinatario: input.destinatario.nome,
    ...(isCpf ? { cpf_destinatario: documentoDigits } : { cnpj_destinatario: documentoDigits }),
    ...(input.destinatario.telefone ? { telefone_destinatario: onlyDigits(input.destinatario.telefone) } : {}),
    // 9 = Não contribuinte, que pode ou não possuir Inscrição Estadual —
    // perfil padrão de venda B2C multicanal (destinatário pessoa física ou
    // empresa não-contribuinte de ICMS).
    indicador_inscricao_estadual_destinatario: 9,
    logradouro_destinatario: input.destinatario.endereco.logradouro,
    numero_destinatario: input.destinatario.endereco.numero,
    bairro_destinatario: input.destinatario.endereco.bairro,
    municipio_destinatario: input.destinatario.endereco.municipio,
    uf_destinatario: input.destinatario.endereco.uf,
    pais_destinatario: input.destinatario.endereco.pais ?? 'Brasil',
    cep_destinatario: onlyDigits(input.destinatario.endereco.cep),
    valor_frete: valorFrete,
    valor_seguro: 0,
    valor_desconto: valorDesconto,
    valor_total: valorTotal,
    valor_produtos: valorProdutos,
    // 9 = Sem frete — Kyneti não controla frota própria/modalidade de frete
    // hoje (gap conhecido, ver docs/fiscal-nfe-architecture.md).
    modalidade_frete: 9,
    // Grupo G (NT 2020.006) — nomes de campo conforme a API da Focus NFe
    // (indicador_intermediario/cnpj_intermediario/id_intermediario). Sempre
    // explícito (nunca omitido): 0 é uma afirmação positiva de "não teve
    // intermediador", não um default silencioso.
    indicador_intermediario: input.intermediador ? 1 : 0,
    ...(input.intermediador
      ? {
          cnpj_intermediario: onlyDigits(input.intermediador.cnpj),
          id_intermediario: input.intermediador.idCadIntTran,
        }
      : {}),
    items: input.items.map((item) => ({
      numero_item: item.numeroItem,
      codigo_produto: item.codigoProduto,
      descricao: item.descricao,
      cfop,
      unidade_comercial: 'UN',
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: item.valorUnitario,
      valor_unitario_tributavel: item.valorUnitario,
      unidade_tributavel: 'UN',
      codigo_ncm: item.ncm,
      // CEST — só enviado quando o produto de fato tem (campo Integer[7] na
      // Focus NFe, ver campos.focusnfe.com.br/nfe/NotaFiscalXML.html).
      // Omitido (não enviado vazio) quando o produto não tem ST.
      ...(item.cest ? { cest: item.cest } : {}),
      quantidade_tributavel: item.quantidade,
      valor_bruto: round2(item.valorBruto),
      icms_origem: item.icmsOrigem ?? ICMS_ORIGEM_FALLBACK,
      icms_situacao_tributaria: ICMS_SITUACAO_TRIBUTARIA_DEFAULT,
      pis_situacao_tributaria: PIS_SITUACAO_TRIBUTARIA_DEFAULT,
      cofins_situacao_tributaria: COFINS_SITUACAO_TRIBUTARIA_DEFAULT,
    })),
  };
}
