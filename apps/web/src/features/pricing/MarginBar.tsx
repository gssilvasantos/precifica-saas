// Conceito "semáforo" pedido: cor da barra muda com a faixa de margem, não
// é uma cor fixa. Faixas confirmadas: <10% perigosa, 10–25% meio-termo,
// >25% excelente.
function marginColor(pct: number): { bar: string; text: string; label: string } {
  if (pct < 10) return { bar: 'bg-margin-danger', text: 'text-margin-danger', label: 'Margem baixa' };
  if (pct <= 25) return { bar: 'bg-margin-warning', text: 'text-margin-warning', label: 'Margem de giro' };
  return { bar: 'bg-margin-good', text: 'text-margin-good', label: 'Margem excelente' };
}

export default function MarginBar({ pct }: { pct: number }) {
  const { bar, text, label } = marginColor(pct);
  const widthPct = Math.max(0, Math.min(100, pct));

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={`text-xs font-medium ${text}`}>{label}</span>
        <span className="font-sans text-sm font-semibold text-ink-900">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-300/40">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}
