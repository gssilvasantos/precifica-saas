// Lucro Presumido e Lucro Real — os dois "regimes normais".
//
// Domínio puro, como simples-nacional.ts. UNIDADE: FRAÇÃO em tudo.
//
// A PERGUNTA QUE ESTE ARQUIVO RESPONDE não é "quanto a empresa paga de
// imposto", e sim: **de cada real a mais de receita, quanto vira imposto?**
// É a única leitura que serve para calcular um piso de preço. Isso muda o que
// entra e o que fica de fora — ver a nota sobre IRPJ/CSLL no Lucro Real.

// --- PIS/Cofins ---
// Cumulativo (Lucro Presumido): alíquotas menores, SEM crédito na compra.
export const PIS_CUMULATIVO = 0.0065;
export const COFINS_CUMULATIVO = 0.03;
// Não cumulativo (Lucro Real): alíquotas maiores, COM crédito na compra.
export const PIS_NAO_CUMULATIVO = 0.0165;
export const COFINS_NAO_CUMULATIVO = 0.076;

// --- IRPJ e CSLL (Lei nº 9.249/1995) ---
export const IRPJ_ALIQUOTA = 0.15;
export const IRPJ_ADICIONAL_ALIQUOTA = 0.1;
export const CSLL_ALIQUOTA = 0.09;
// O adicional de 10% incide sobre a parcela da base de cálculo que exceder
// R$ 20.000 por mês de período de apuração. É ESCALÃO, não alíquota linear.
export const LIMITE_MENSAL_ADICIONAL_IRPJ = 20_000;

export interface RegimeNormalBreakdown {
  pis: number;
  cofins: number;
  icms: number;
  irpj?: number;
  irpjAdicional?: number;
  csll?: number;
}

export interface RegimeNormalResult {
  // O que entra no DENOMINADOR do piso de preço: a fatia de cada real de
  // receita que vira imposto.
  effectiveRate: number;
  // O que volta como crédito na COMPRA, reduzindo o custo — não a alíquota.
  // Ver §3.6 do doc: crédito muda o custo, não o imposto.
  creditableRate: number;
  breakdown: RegimeNormalBreakdown;
}

export class ConfiguracaoRegimeNormalAusenteError extends Error {
  constructor(readonly campo: string) {
    super(
      `O regime normal exige ${campo}, que não está configurado para este tenant. ` +
        'O cálculo foi BLOQUEADO em vez de assumir zero — precificar sem ICMS erra para menos, ' +
        'e imposto subestimado superestima margem.',
    );
    this.name = 'ConfiguracaoRegimeNormalAusenteError';
  }
}

export interface LucroPresumidoInput {
  icmsAliquota: number;
  presuncaoIrpj: number; // 0.08 no comércio, até 0.32 em serviços
  presuncaoCsll: number; // 0.12 no comércio
  // Receita mensal de referência, usada só para saber se o ADICIONAL de IRPJ
  // já incide. Ver a nota em `adicionalIncide` abaixo.
  receitaMensalReferencia: number;
}

// No Lucro Presumido, IRPJ e CSLL também são proporcionais à receita — a base
// é uma PRESUNÇÃO sobre ela (8% e 12% no comércio). Por isso os quatro tributos
// entram no piso: todos são custo marginal de vender mais um item.
//
// É a diferença essencial para o Lucro Real, logo abaixo.
export function calcularLucroPresumido(input: LucroPresumidoInput): RegimeNormalResult {
  const irpj = input.presuncaoIrpj * IRPJ_ALIQUOTA;
  const csll = input.presuncaoCsll * CSLL_ALIQUOTA;

  // O adicional é escalão: só a parcela da base presumida acima de R$ 20.000
  // no mês é atingida. Para efeito de PREÇO o que importa é a posição
  // MARGINAL — se a empresa já passou do limite, cada real a mais carrega
  // presunção × 10%; se está abaixo, não carrega nada.
  const basePresumidaMensal = input.receitaMensalReferencia * input.presuncaoIrpj;
  const adicionalIncide = basePresumidaMensal > LIMITE_MENSAL_ADICIONAL_IRPJ;
  const irpjAdicional = adicionalIncide ? input.presuncaoIrpj * IRPJ_ADICIONAL_ALIQUOTA : 0;

  const breakdown: RegimeNormalBreakdown = {
    pis: PIS_CUMULATIVO,
    cofins: COFINS_CUMULATIVO,
    icms: input.icmsAliquota,
    irpj,
    irpjAdicional,
    csll,
  };

  return {
    effectiveRate: PIS_CUMULATIVO + COFINS_CUMULATIVO + input.icmsAliquota + irpj + irpjAdicional + csll,
    // No regime CUMULATIVO não há crédito de PIS/Cofins. O ICMS continua
    // não cumulativo (é garantia constitucional, independe do regime de IRPJ),
    // então o crédito da compra é só ele.
    creditableRate: input.icmsAliquota,
    breakdown,
  };
}

export interface LucroRealInput {
  icmsAliquota: number;
}

// No Lucro Real, IRPJ e CSLL incidem sobre o LUCRO APURADO, não sobre a
// receita — e é por isso que eles NÃO entram aqui.
//
// Colocá-los no denominador do piso trataria imposto sobre resultado como se
// fosse custo de transação, e inflaria o preço mínimo de todo produto. O art.
// 187, V da Lei nº 6.404/1976 diz o mesmo em linguagem contábil: o resultado
// do exercício vem ANTES do imposto de renda e da sua provisão, em linha
// própria. IRPJ e CSLL pertencem ao DRE, abaixo do resultado operacional.
//
// O que sobra como custo marginal de vender: PIS e Cofins não cumulativos e o
// ICMS.
export function calcularLucroReal(input: LucroRealInput): RegimeNormalResult {
  const breakdown: RegimeNormalBreakdown = {
    pis: PIS_NAO_CUMULATIVO,
    cofins: COFINS_NAO_CUMULATIVO,
    icms: input.icmsAliquota,
  };

  return {
    effectiveRate: PIS_NAO_CUMULATIVO + COFINS_NAO_CUMULATIVO + input.icmsAliquota,
    // Regime NÃO CUMULATIVO: as compras geram crédito de PIS/Cofins (9,25%)
    // além do ICMS. É a razão de o custo relevante para precificar ser o valor
    // da nota MENOS o crédito — usar o valor cheio superestima o custo em até
    // 9,25 pontos, e o piso sai alto demais.
    creditableRate: PIS_NAO_CUMULATIVO + COFINS_NAO_CUMULATIVO + input.icmsAliquota,
    breakdown,
  };
}
