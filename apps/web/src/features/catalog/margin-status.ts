// Cálculo puro (sem React/query aqui) do "status de saúde de margem" usado
// na listagem do catálogo. Diferente do MarginBar semáforo da tela de
// detalhe (que usa faixas fixas 10%/25% para visualizar UM cenário
// calculado com taxa de gateway) — aqui o piso vem do PRÓPRIO produto
// (Product.minimumMarginPct), porque é exatamente para isso que esse campo
// existe (PRD, seção 1.2: piso de segurança configurável por SKU, não uma
// constante global). E aqui o preço/margem são uma média simples entre
// canais vinculados (sem taxa de gateway) — resumo rápido de lista, não o
// cálculo fino da tela de precificação.
export type MarginStatus = 'SEM_DADO' | 'PREJUIZO' | 'BAIXA' | 'SAUDAVEL';

export interface MarginStatusInfo {
  status: MarginStatus;
  label: string;
  badgeClass: string;
}

export function computeMarginStatus(marginPct: number | null, minimumMarginPct: number): MarginStatusInfo {
  if (marginPct === null) {
    return { status: 'SEM_DADO', label: 'Sem canal vinculado', badgeClass: 'bg-ink-300/40 text-ink-700' };
  }
  if (marginPct < 0) {
    return { status: 'PREJUIZO', label: 'Prejuízo', badgeClass: 'bg-margin-danger/15 text-margin-danger' };
  }
  if (marginPct < minimumMarginPct) {
    return { status: 'BAIXA', label: 'Margem baixa', badgeClass: 'bg-margin-warning/15 text-margin-warning' };
  }
  return { status: 'SAUDAVEL', label: 'Margem saudável', badgeClass: 'bg-margin-good/15 text-margin-good' };
}

// Preço médio simples entre os canais que têm ChannelListing para o SKU —
// sem taxa de gateway (isso é o que a tela de detalhe calcula por cenário).
export function averageChannelPrice(prices: (number | null)[]): number | null {
  const valid = prices.filter((p): p is number => p !== null && p > 0);
  if (valid.length === 0) return null;
  return valid.reduce((sum, p) => sum + p, 0) / valid.length;
}

export function grossMarginPct(avgPrice: number | null, costPrice: number): number | null {
  if (avgPrice === null || avgPrice <= 0) return null;
  return ((avgPrice - costPrice) / avgPrice) * 100;
}
