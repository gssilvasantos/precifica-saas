// Inteligência de Abastecimento (Sprint 25) — fecha o gap explicitamente
// deixado como "próxima fatia" ao final da Sprint 24
// (docs/logistics-fulfillment-architecture.md, seção 6). Curva ABC (por
// participação acumulada de giro, método de Pareto) + sugestão de
// transferência físico -> Full, tudo em funções puras testáveis sem banco.
export type AbcClass = 'A' | 'B' | 'C';

export type ReplenishmentStatus =
  | 'CRITICO' // cobertura atual no Full é MENOR que o lead time — risco real de ruptura antes do próximo reabastecimento chegar
  | 'ATENCAO' // cobertura cobre o lead time, mas não o estoque de segurança da classe ABC
  | 'OK' // cobertura já atende o alvo (lead time + segurança) — nenhum envio necessário agora
  | 'SEM_GIRO'; // nenhuma venda no canal na janela analisada — sugestão de envio é sempre 0, não há dado para decidir

export interface AbcInput {
  skuCode: string;
  unitsSoldInWindow: number;
}

// Estoque de segurança (em dias de giro) por classe ABC — SKUs classe A
// (os que concentram a maior parte do giro) recebem um buffer maior porque
// o custo de ruptura deles é desproporcionalmente mais caro; classe C
// recebe o mínimo, para não empatar capital físico num item de giro baixo.
const SAFETY_DAYS_BY_CLASS: Record<AbcClass, number> = { A: 7, B: 4, C: 2 };

// Classificação ABC pelo método de Pareto clássico: ordena por giro
// (unidades vendidas na janela) desc, acumula a participação e corta em
// 80%/95%. SKUs com giro zero (sem venda na janela) recebem 'C' — a
// classe menos exigente, já que `computeReplenishmentSuggestion` os trata
// como 'SEM_GIRO' de qualquer forma (a classe não chega a ser usada no
// cálculo, mas o campo precisa de um valor não-nulo para exibição na tabela).
export function classifyAbc(inputs: AbcInput[]): Map<string, AbcClass> {
  const totalUnits = inputs.reduce((sum, i) => sum + i.unitsSoldInWindow, 0);
  const result = new Map<string, AbcClass>();

  if (totalUnits === 0) {
    for (const input of inputs) result.set(input.skuCode, 'C');
    return result;
  }

  const sorted = [...inputs].sort((a, b) => b.unitsSoldInWindow - a.unitsSoldInWindow);
  let cumulative = 0;
  for (const input of sorted) {
    cumulative += input.unitsSoldInWindow;
    const cumulativeShare = cumulative / totalUnits;
    const abcClass: AbcClass = cumulativeShare <= 0.8 ? 'A' : cumulativeShare <= 0.95 ? 'B' : 'C';
    result.set(input.skuCode, abcClass);
  }
  return result;
}

export interface ReplenishmentSuggestionInput {
  giroDiario: number; // unidades vendidas na janela / dias da janela
  saldoFull: number; // saldo atual no depósito virtual do canal (StockLedgerEntry)
  saldoFisico: number; // saldo atual no depósito físico — teto real do que pode ser enviado
  leadTimeDays: number; // dias entre despacho do físico e disponibilidade para venda no CD
  abcClass: AbcClass;
}

export interface ReplenishmentSuggestion {
  coberturaDiasFull: number | null; // null quando giroDiario = 0 (cobertura "infinita" não é um número útil)
  sugestaoEnvio: number; // unidades — nunca maior que saldoFisico disponível
  status: ReplenishmentStatus;
  physicalShortfall: boolean; // true quando o físico não tem saldo suficiente para cobrir a sugestão ideal
}

// O núcleo da "inteligência de abastecimento" pedida: dado o giro e os dois
// saldos, decide QUANTO sugerir enviar do físico para o Full e QUÃO urgente
// isso é. Nunca sugere mais do que o físico realmente tem disponível — a
// decisão de comprar mais estoque físico é humana, esta função só realoca o
// que já existe.
export function computeReplenishmentSuggestion(input: ReplenishmentSuggestionInput): ReplenishmentSuggestion {
  const { giroDiario, saldoFull, saldoFisico, leadTimeDays, abcClass } = input;

  if (giroDiario <= 0) {
    return { coberturaDiasFull: null, sugestaoEnvio: 0, status: 'SEM_GIRO', physicalShortfall: false };
  }

  const coberturaDiasFull = saldoFull / giroDiario;
  const safetyDays = SAFETY_DAYS_BY_CLASS[abcClass];
  const targetCoverageDays = leadTimeDays + safetyDays;
  const targetStock = giroDiario * targetCoverageDays;

  const sugestaoIdeal = Math.max(0, targetStock - saldoFull);
  const sugestaoEnvio = Math.min(Math.ceil(sugestaoIdeal), Math.max(0, Math.floor(saldoFisico)));
  const physicalShortfall = sugestaoIdeal > 0 && saldoFisico < sugestaoIdeal;

  const status: ReplenishmentStatus =
    coberturaDiasFull < leadTimeDays ? 'CRITICO' : coberturaDiasFull < targetCoverageDays ? 'ATENCAO' : 'OK';

  return { coberturaDiasFull, sugestaoEnvio, status, physicalShortfall };
}
