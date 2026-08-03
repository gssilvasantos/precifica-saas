// Núcleo de domínio do Tax Intelligence — o cálculo do Simples Nacional.
//
// 100% domínio puro: sem NestJS, sem Prisma, sem I/O. Recebe números, devolve
// números — a mesma disciplina de pricing-strategist.ts.
//
// POR QUE ESTE ARQUIVO EXISTE (docs/tributacao-br-regimes-e-reforma.md):
// até 02/08/2026 o sistema inteiro dependia de CatalogSettings.taxRatePct — UM
// Float por tenant, digitado à mão. A alíquota do Simples não é um parâmetro
// que alguém escolhe: é o RESULTADO de uma fórmula sobre o faturamento dos 12
// meses anteriores, que muda todo mês e ainda varia por produto.
//
// UNIDADE: FRAÇÃO em tudo (0.0721 = 7,21%), como já vale para commissionPct em
// shared/contracts/fee-rule-resolver.port.ts.
//
// PROCEDÊNCIA DAS TABELAS: todas transcritas dos Anexos I a V da LC 123/2006
// (redação da LC 155/2016, vigência 01/01/2018), lidos do PDF oficial do
// Planalto. Conferidas contra um extrato real do PGDAS-D — ver o .spec.

export type SimplesAnexo = 'I' | 'II' | 'III' | 'IV' | 'V';

export type TributoSimples = 'irpj' | 'csll' | 'cofins' | 'pisPasep' | 'cpp' | 'icms' | 'ipi' | 'iss';

// Percentuais de repartição de uma faixa (art. 18, §1º-B da LC 123/2006).
// Somam 1 em toda faixa. Todos opcionais porque a composição muda por Anexo:
// o II tem IPI, o IV não tem CPP, os de serviço não têm ICMS.
export type PartilhaTributos = Partial<Record<TributoSimples, number>>;

export interface SimplesFaixa {
  ordem: 1 | 2 | 3 | 4 | 5 | 6;
  rbt12Max: number | null; // inclusive; null = última faixa
  aliquotaNominal: number; // FRAÇÃO
  parcelaDeduzir: number; // R$
  partilha: PartilhaTributos;
}

// Tributos que recebem o excedente quando o teto do ISS morde. "Federais" no
// sentido do art. 18, §1º-B, I — ICMS (estadual) e ISS (municipal) ficam fora.
const TRIBUTOS_FEDERAIS: TributoSimples[] = ['irpj', 'csll', 'cofins', 'pisPasep', 'cpp'];

const p = (
  irpj: number,
  csll: number,
  cofins: number,
  pisPasep: number,
  extra: PartilhaTributos,
): PartilhaTributos => ({ irpj, csll, cofins, pisPasep, ...extra });

// --- Anexo I — Comércio (revenda de mercadorias) ---
export const SIMPLES_ANEXO_I: SimplesFaixa[] = [
  { ordem: 1, rbt12Max: 180_000, aliquotaNominal: 0.04, parcelaDeduzir: 0,
    partilha: p(0.055, 0.035, 0.1274, 0.0276, { cpp: 0.415, icms: 0.34 }) },
  { ordem: 2, rbt12Max: 360_000, aliquotaNominal: 0.073, parcelaDeduzir: 5_940,
    partilha: p(0.055, 0.035, 0.1274, 0.0276, { cpp: 0.415, icms: 0.34 }) },
  { ordem: 3, rbt12Max: 720_000, aliquotaNominal: 0.095, parcelaDeduzir: 13_860,
    partilha: p(0.055, 0.035, 0.1274, 0.0276, { cpp: 0.42, icms: 0.335 }) },
  { ordem: 4, rbt12Max: 1_800_000, aliquotaNominal: 0.107, parcelaDeduzir: 22_500,
    partilha: p(0.055, 0.035, 0.1274, 0.0276, { cpp: 0.42, icms: 0.335 }) },
  { ordem: 5, rbt12Max: 3_600_000, aliquotaNominal: 0.143, parcelaDeduzir: 87_300,
    partilha: p(0.055, 0.035, 0.1274, 0.0276, { cpp: 0.42, icms: 0.335 }) },
  // Acima do sublimite o ICMS sai do DAS e vai para guia própria — por isso a
  // 6ª faixa não reparte ICMS. Atenção: isso NÃO significa carga menor, só
  // outra guia. Ver o comentário de segregarAliquota.
  { ordem: 6, rbt12Max: null, aliquotaNominal: 0.19, parcelaDeduzir: 378_000,
    partilha: p(0.135, 0.1, 0.2827, 0.0613, { cpp: 0.421 }) },
];

// --- Anexo II — Indústria (o único com IPI) ---
export const SIMPLES_ANEXO_II: SimplesFaixa[] = [
  { ordem: 1, rbt12Max: 180_000, aliquotaNominal: 0.045, parcelaDeduzir: 0,
    partilha: p(0.055, 0.035, 0.1151, 0.0249, { cpp: 0.375, ipi: 0.075, icms: 0.32 }) },
  { ordem: 2, rbt12Max: 360_000, aliquotaNominal: 0.078, parcelaDeduzir: 5_940,
    partilha: p(0.055, 0.035, 0.1151, 0.0249, { cpp: 0.375, ipi: 0.075, icms: 0.32 }) },
  { ordem: 3, rbt12Max: 720_000, aliquotaNominal: 0.1, parcelaDeduzir: 13_860,
    partilha: p(0.055, 0.035, 0.1151, 0.0249, { cpp: 0.375, ipi: 0.075, icms: 0.32 }) },
  { ordem: 4, rbt12Max: 1_800_000, aliquotaNominal: 0.112, parcelaDeduzir: 22_500,
    partilha: p(0.055, 0.035, 0.1151, 0.0249, { cpp: 0.375, ipi: 0.075, icms: 0.32 }) },
  // Parcela a deduzir 85.500 — diferente dos 87.300 do Anexo I na mesma faixa.
  { ordem: 5, rbt12Max: 3_600_000, aliquotaNominal: 0.147, parcelaDeduzir: 85_500,
    partilha: p(0.055, 0.035, 0.1151, 0.0249, { cpp: 0.375, ipi: 0.075, icms: 0.32 }) },
  { ordem: 6, rbt12Max: null, aliquotaNominal: 0.3, parcelaDeduzir: 720_000,
    partilha: p(0.085, 0.075, 0.2096, 0.0454, { cpp: 0.235, ipi: 0.35 }) },
];

// --- Anexo III — Locação de bens móveis e serviços do art. 18, §5º-C ---
export const SIMPLES_ANEXO_III: SimplesFaixa[] = [
  { ordem: 1, rbt12Max: 180_000, aliquotaNominal: 0.06, parcelaDeduzir: 0,
    partilha: p(0.04, 0.035, 0.1282, 0.0278, { cpp: 0.434, iss: 0.335 }) },
  { ordem: 2, rbt12Max: 360_000, aliquotaNominal: 0.112, parcelaDeduzir: 9_360,
    partilha: p(0.04, 0.035, 0.1405, 0.0305, { cpp: 0.434, iss: 0.32 }) },
  { ordem: 3, rbt12Max: 720_000, aliquotaNominal: 0.135, parcelaDeduzir: 17_640,
    partilha: p(0.04, 0.035, 0.1364, 0.0296, { cpp: 0.434, iss: 0.325 }) },
  { ordem: 4, rbt12Max: 1_800_000, aliquotaNominal: 0.16, parcelaDeduzir: 35_640,
    partilha: p(0.04, 0.035, 0.1364, 0.0296, { cpp: 0.434, iss: 0.325 }) },
  { ordem: 5, rbt12Max: 3_600_000, aliquotaNominal: 0.21, parcelaDeduzir: 125_640,
    partilha: p(0.04, 0.035, 0.1282, 0.0278, { cpp: 0.434, iss: 0.335 }) },
  { ordem: 6, rbt12Max: null, aliquotaNominal: 0.33, parcelaDeduzir: 648_000,
    partilha: p(0.35, 0.15, 0.1603, 0.0347, { cpp: 0.305 }) },
];

// --- Anexo IV — Serviços do art. 18, §5º-C. Único SEM CPP na partilha:
// a contribuição previdenciária é recolhida à parte, fora do DAS. ---
export const SIMPLES_ANEXO_IV: SimplesFaixa[] = [
  { ordem: 1, rbt12Max: 180_000, aliquotaNominal: 0.045, parcelaDeduzir: 0,
    partilha: p(0.188, 0.152, 0.1767, 0.0383, { iss: 0.445 }) },
  { ordem: 2, rbt12Max: 360_000, aliquotaNominal: 0.09, parcelaDeduzir: 8_100,
    partilha: p(0.198, 0.152, 0.2055, 0.0445, { iss: 0.4 }) },
  { ordem: 3, rbt12Max: 720_000, aliquotaNominal: 0.102, parcelaDeduzir: 12_420,
    partilha: p(0.208, 0.152, 0.1973, 0.0427, { iss: 0.4 }) },
  { ordem: 4, rbt12Max: 1_800_000, aliquotaNominal: 0.14, parcelaDeduzir: 39_780,
    partilha: p(0.178, 0.192, 0.189, 0.041, { iss: 0.4 }) },
  { ordem: 5, rbt12Max: 3_600_000, aliquotaNominal: 0.22, parcelaDeduzir: 183_780,
    partilha: p(0.188, 0.192, 0.1808, 0.0392, { iss: 0.4 }) },
  { ordem: 6, rbt12Max: null, aliquotaNominal: 0.33, parcelaDeduzir: 828_000,
    partilha: p(0.535, 0.215, 0.2055, 0.0445, {}) },
];

// --- Anexo V — Serviços do art. 18, §5º-I (fator r < 0,28) ---
export const SIMPLES_ANEXO_V: SimplesFaixa[] = [
  { ordem: 1, rbt12Max: 180_000, aliquotaNominal: 0.155, parcelaDeduzir: 0,
    partilha: p(0.25, 0.15, 0.141, 0.0305, { cpp: 0.2885, iss: 0.14 }) },
  { ordem: 2, rbt12Max: 360_000, aliquotaNominal: 0.18, parcelaDeduzir: 4_500,
    partilha: p(0.23, 0.15, 0.141, 0.0305, { cpp: 0.2785, iss: 0.17 }) },
  { ordem: 3, rbt12Max: 720_000, aliquotaNominal: 0.195, parcelaDeduzir: 9_900,
    partilha: p(0.24, 0.15, 0.1492, 0.0323, { cpp: 0.2385, iss: 0.19 }) },
  { ordem: 4, rbt12Max: 1_800_000, aliquotaNominal: 0.205, parcelaDeduzir: 17_100,
    partilha: p(0.21, 0.15, 0.1574, 0.0341, { cpp: 0.2385, iss: 0.21 }) },
  { ordem: 5, rbt12Max: 3_600_000, aliquotaNominal: 0.23, parcelaDeduzir: 62_100,
    partilha: p(0.23, 0.125, 0.141, 0.0305, { cpp: 0.2385, iss: 0.235 }) },
  { ordem: 6, rbt12Max: null, aliquotaNominal: 0.305, parcelaDeduzir: 540_000,
    partilha: p(0.35, 0.155, 0.1644, 0.0356, { cpp: 0.295 }) },
];

export const SIMPLES_ANEXOS: Record<SimplesAnexo, SimplesFaixa[]> = {
  I: SIMPLES_ANEXO_I,
  II: SIMPLES_ANEXO_II,
  III: SIMPLES_ANEXO_III,
  IV: SIMPLES_ANEXO_IV,
  V: SIMPLES_ANEXO_V,
};

export class FaixaNaoEncontradaError extends Error {
  constructor(anexo: SimplesAnexo, rbt12: number) {
    super(
      `Nenhuma faixa do Anexo ${anexo} cobre um RBT12 de ${rbt12.toFixed(2)}. ` +
        'Isso não deveria acontecer — a última faixa não tem teto.',
    );
    this.name = 'FaixaNaoEncontradaError';
  }
}

export function resolveFaixa(anexo: SimplesAnexo, rbt12: number): SimplesFaixa {
  const faixa = SIMPLES_ANEXOS[anexo].find((f) => f.rbt12Max === null || rbt12 <= f.rbt12Max);
  if (!faixa) throw new FaixaNaoEncontradaError(anexo, rbt12);
  return faixa;
}

// A fórmula do art. 18, §1º-A da LC 123/2006:
//
//     alíquota efetiva = (RBT12 × Aliq − PD) / RBT12
//
// RBT12 zero acontece de verdade: empresa que migrou do MEI e cujo quadro de
// receitas anteriores está zerado, ou primeiro mês de operação. A 1ª faixa tem
// PD = 0, então a expressão vale a alíquota nominal para qualquer RBT12 dentro
// dela — e o limite quando RBT12 → 0 é a própria nominal. Devolver isso é
// contínuo e correto; dividir por zero, não.
export function calcularAliquotaEfetiva(rbt12: number, faixa: SimplesFaixa): number {
  if (rbt12 <= 0) return faixa.aliquotaNominal;
  return (rbt12 * faixa.aliquotaNominal - faixa.parcelaDeduzir) / rbt12;
}

export interface SegregacaoProduto {
  // Receita de revenda cujo ICMS já foi recolhido por substituto tributário.
  // Sair da conta está CERTO: o ICMS-ST já foi pago pelo substituto e já está
  // embutido no preço de compra — ou seja, já está dentro do costPrice que o
  // Kyneti importa do ERP. Não retirar aqui seria cobrá-lo duas vezes.
  icmsSt: boolean;
  // Tributação monofásica de PIS/Cofins (Lei 10.147/2000 para perfumaria e
  // higiene pessoal, entre outras). Federal e permanente.
  monofasico: boolean;
}

export interface AliquotaSegregada {
  effectiveRate: number;
  aliquotaCheia: number;
  removido: { icms: number; pisCofins: number };
}

// Art. 18, §4º-A, I + §12 da LC 123/2006: as receitas com ST/monofásico são
// segregadas e "serão desconsiderados, no cálculo do Simples Nacional, os
// percentuais a elas correspondentes".
//
// A remoção é MULTIPLICATIVA sobre a alíquota efetiva, porque o §1º-B define
// que "os percentuais efetivos de cada tributo serão calculados a partir da
// alíquota efetiva, multiplicada pelo percentual de repartição".
//
// CUIDADO — o que NÃO entra aqui: acima do sublimite o ICMS também sai do DAS
// (é por isso que a 6ª faixa não o reparte). Mas ali ele só MUDA DE GUIA, o
// vendedor continua pagando. Tratar os dois casos com a mesma função reduziria
// a carga de um tenant que não teve redução nenhuma, e o piso de preço sairia
// otimista — a direção de erro mais cara. Somar o ICMS por fora, nesse caso, é
// responsabilidade de quem monta o contexto.
export function segregarAliquota(
  aliquotaEfetiva: number,
  partilha: PartilhaTributos,
  produto: SegregacaoProduto,
): AliquotaSegregada {
  const icms = produto.icmsSt ? (partilha.icms ?? 0) : 0;
  const pisCofins = produto.monofasico ? (partilha.cofins ?? 0) + (partilha.pisPasep ?? 0) : 0;

  return {
    effectiveRate: aliquotaEfetiva * (1 - icms - pisCofins),
    aliquotaCheia: aliquotaEfetiva,
    removido: { icms, pisCofins },
  };
}

export type AliquotaPorTributo = Partial<Record<TributoSimples, number>>;

// Teto de 5% no ISS — art. 18, §1º-B, I.
//
// SUTILEZA QUE EU TINHA ERRADO NA PRIMEIRA VERSÃO: o teto é sobre o PERCENTUAL
// EFETIVO do ISS (ou seja, sobre `alíquota efetiva × repartição do ISS`), não
// sobre a repartição isolada. Comparar a repartição (33,5% no Anexo III) com
// 5% acionaria o teto sempre, o que está errado.
//
// A lei confirma a leitura ao publicar o limiar: no Anexo III, 5ª faixa, o teto
// morde "quando a alíquota efetiva for superior a 14,92537%" — que é
// exatamente 0,05 / 0,335. No Anexo IV, 12,5% = 0,05 / 0,40.
//
// A redistribuição é PROPORCIONAL aos tributos federais da mesma faixa. Os
// coeficientes que a lei publica são justamente essa proporção: no Anexo III,
// 5ª faixa, CPP = 43,40% / 66,50% = 65,26%, igual ao texto legal.
const TETO_ISS_EFETIVO = 0.05;

export function calcularAliquotasPorTributo(
  aliquotaEfetiva: number,
  partilha: PartilhaTributos,
): AliquotaPorTributo {
  const repartidoIss = partilha.iss ?? 0;
  const issEfetivo = aliquotaEfetiva * repartidoIss;

  if (repartidoIss === 0 || issEfetivo <= TETO_ISS_EFETIVO) {
    const direto: AliquotaPorTributo = {};
    for (const [tributo, pct] of Object.entries(partilha) as [TributoSimples, number][]) {
      if (pct > 0) direto[tributo] = aliquotaEfetiva * pct;
    }
    return direto;
  }

  // Teto acionado: ISS fixo em 5% e o restante da alíquota efetiva vai para os
  // federais, na proporção que eles guardam entre si.
  const totalFederal = TRIBUTOS_FEDERAIS.reduce((acc, t) => acc + (partilha[t] ?? 0), 0);
  const restante = aliquotaEfetiva - TETO_ISS_EFETIVO;

  const comTeto: AliquotaPorTributo = { iss: TETO_ISS_EFETIVO };
  for (const tributo of TRIBUTOS_FEDERAIS) {
    const pct = partilha[tributo] ?? 0;
    if (pct > 0) comTeto[tributo] = restante * (pct / totalFederal);
  }
  // ICMS/IPI não recebem o excedente (só "tributos federais"), mas continuam
  // com sua fatia normal quando existirem. Na prática nenhum Anexo tem ISS e
  // ICMS ao mesmo tempo — o loop existe para não depender disso.
  for (const tributo of ['icms', 'ipi'] as TributoSimples[]) {
    const pct = partilha[tributo] ?? 0;
    if (pct > 0) comTeto[tributo] = aliquotaEfetiva * pct;
  }
  return comTeto;
}

function arredondarCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export interface DasCalculado {
  porTributo: Partial<Record<TributoSimples, number>>;
  total: number;
}

// Calcula o DAS do período, tributo a tributo.
//
// ORDEM DAS OPERAÇÕES — importa, e foi descoberta conferindo contra o extrato
// oficial. O total NÃO é `arredondar(receita × alíquota efetiva)`: é a SOMA dos
// valores de cada tributo, cada um arredondado individualmente.
//
// No extrato real (PA 06/2026): receita × efetiva = 13.616,15349, que
// arredondado dá 13.616,15 — mas o DAS oficial é 13.616,16. A diferença aparece
// porque o valor de cada tributo é arredondado ANTES da soma:
//
//     IRPJ   13.616,15349 × 0,0550 = 748,888442   → 748,89
//     CSLL                × 0,0350 = 476,565372   → 476,57
//     COFINS              × 0,1274 = 1.734,697555 → 1.734,70
//     PIS                 × 0,0276 = 375,805836   → 375,81
//     CPP                 × 0,4200 = 5.718,784466 → 5.718,78
//     ICMS                × 0,3350 = 4.561,411419 → 4.561,41
//                                                   ----------
//                                                    13.616,16  ✓ oficial
//
// Arredondar o total antes de repartir erra por centavos, e erra sempre no
// mesmo lugar — o suficiente para a conciliação com a guia nunca fechar.
export function calcularDas(
  receitaDoPeriodo: number,
  aliquotaEfetiva: number,
  partilha: PartilhaTributos,
): DasCalculado {
  const porAliquota = calcularAliquotasPorTributo(aliquotaEfetiva, partilha);

  const porTributo: Partial<Record<TributoSimples, number>> = {};
  let total = 0;
  for (const [tributo, aliquota] of Object.entries(porAliquota) as [TributoSimples, number][]) {
    const valor = arredondarCentavos(receitaDoPeriodo * aliquota);
    porTributo[tributo] = valor;
    total += valor;
  }

  return { porTributo, total: arredondarCentavos(total) };
}
