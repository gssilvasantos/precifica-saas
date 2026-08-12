// Porta exportada pelo Tax Intelligence e consumida pelo Pricing Intelligence
// (piso de preço e simulador), pelo Promotion Intelligence e pelo Financial
// Intelligence (deduções do DRE). É a ÚNICA coisa que esses módulos conhecem
// da tributação — nenhum deles importa a tabela do Anexo I nem sabe o que é
// RBT12.
//
// Substitui o uso de CatalogSettings.taxRatePct como fonte da alíquota. Aquele
// campo é UM Float por tenant, digitado à mão, e está errado por construção:
// a alíquota do Simples é calculada sobre o faturamento dos 12 meses
// anteriores, muda todo mês e ainda varia POR PRODUTO (ST e monofásico).
// Ver docs/tributacao-br-regimes-e-reforma.md.
//
// UNIDADE: FRAÇÃO (0.0721 = 7,21%), mesma convenção de commissionPct em
// fee-rule-resolver.port.ts.

export type TaxRegime = 'MEI_SIMEI' | 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL';

// Como o imposto incide sobre o preço — e isso muda a FÓRMULA do piso, não um
// parâmetro dela.
//
//   POR_DENTRO: o imposto está contido no preço (ICMS, PIS/Cofins e o DAS do
//               Simples hoje). Piso = custo / (1 − comissão − imposto − margem).
//   POR_FORA:   o imposto é acrescido sobre o preço (CBS/IBS a partir de 2027).
//               Piso líquido primeiro, imposto depois.
//
// Existe desde já, mesmo valendo constante POR_DENTRO até 2027, para que a
// transição não exija mudar a assinatura de tudo que consome esta porta.
export type TaxIncidence = 'POR_DENTRO' | 'POR_FORA';

// De onde veio o número. Mesma razão de existir do `dataQuality` nos pedidos:
// distinguir o que o sistema CALCULOU do que alguém DIGITOU. Uma alíquota
// digitada não é um erro — mas o usuário precisa saber que é digitada.
export type TaxRateSource =
  | 'CALCULATED_RBT12' // Simples: calculada a partir do faturamento real
  | 'FIXED_REGIME_RATE' // Presumido/Real: percentual fixo do regime
  | 'NOT_APPLICABLE' // MEI: imposto é valor fixo mensal, não percentual
  | 'MANUAL_OVERRIDE'; // o tenant sobrescreveu — sempre exibir o calculado ao lado

// Memória de cálculo. Responde "por que 7,21%?" sem obrigar ninguém a refazer
// a conta — é o que permite ao contador auditar em segundos em vez de
// recalcular. Campos opcionais porque só o Simples tem faixa e RBT12.
export interface TaxRateBreakdown {
  rbt12?: number;
  anexo?: string;
  faixa?: number;
  aliquotaNominal?: number;
  parcelaDeduzir?: number;
  aliquotaCheia?: number; // antes da segregação por produto
  removidoIcmsSt?: number; // fração da partilha retirada por ST
  removidoMonofasico?: number; // fração retirada por PIS/Cofins monofásico
  // Norma que fundamenta o resultado — 'LC_123_2006_ART_18' para o Simples,
  // 'PORTARIA_SRE_94_2025' quando a resposta depende de o produto ter saído da
  // ST, e assim por diante.
  fundamentacao?: string[];
}

export interface ResolvedTaxRate {
  effectiveRate: number; // FRAÇÃO
  incidence: TaxIncidence;
  // Crédito de entrada aproveitável (CBS/IBS a partir de 2027; PIS/Cofins não
  // cumulativos no Lucro Real). Zero em MEI e Simples na guia única — o
  // optante do Simples não se apropria de crédito (art. 24 da LC 123/2006).
  creditableRate: number;
  regime: TaxRegime;
  source: TaxRateSource;
  breakdown: TaxRateBreakdown;
  // Imposto que NÃO é percentual do preço e por isso não entra no piso: o DAS
  // fixo do MEI. Quem monta o DRE lança como despesa fixa do mês. Ver §1.1 do
  // doc — para um tenant MEI, qualquer percentual digitado está errado.
  fixedMonthlyTaxAmount: number | null;
}

// Lançada quando não dá para responder com honestidade. NUNCA devolver zero
// nem estimativa: alíquota errada contamina piso de preço e DRE, e o erro para
// menos (imposto subestimado) superestima a margem — a direção mais cara.
//
// Mesma disciplina do PricingDecisionService, que bloqueia a decisão quando a
// comissão do canal ainda não foi importada em vez de assumir zero.
export class TaxRateUnavailableError extends Error {
  constructor(
    readonly reason:
      | 'REGIME_NAO_CONFIGURADO'
      | 'RBT12_INCOMPLETO'
      | 'ANEXO_NAO_CONFERIDO'
      | 'PERFIL_DO_PRODUTO_AUSENTE',
    detail: string,
  ) {
    super(`Não foi possível resolver a alíquota (${reason}): ${detail}`);
    this.name = 'TaxRateUnavailableError';
  }
}

export interface TaxRateQuery {
  tenantId: string;
  // A alíquota varia por produto: ST e monofásico são atributos do item, não
  // do tenant. Ver §1.2.1 do doc.
  productId: string;
  // ST é regime ESTADUAL — o mesmo NCM pode estar em ST no PR e fora dela em
  // SP. Sem a UF na chave o sistema só atende vendedor de um estado.
  //
  // OPCIONAL desde 12/08/2026. Quem consome esta porta (Pricing, DRE) não tem
  // como saber a UF: ela vive no perfil tributário do tenant, que é justamente
  // o que este módulo encapsula — exigir o campo obrigaria o Pricing a ler
  // dado de tributação para poder perguntar sobre tributação.
  //
  // Ausente = a UF do estabelecimento, lida do perfil vigente. O parâmetro
  // continua existindo para o caso legítimo de simular OUTRA UF (venda
  // interestadual, estudo de operação em outro estado).
  uf?: string;
  // A data importa de verdade: São Paulo tirou perfumaria e higiene pessoal da
  // ST em 01/04/2026 (Portaria SRE 94/2025). O mesmo SKU tem alíquotas
  // diferentes antes e depois — e um mês já fechado precisa continuar sendo
  // calculado com a regra que valia nele.
  at: Date;
}

export interface TaxRateResolver {
  resolve(query: TaxRateQuery): Promise<ResolvedTaxRate>;
}
