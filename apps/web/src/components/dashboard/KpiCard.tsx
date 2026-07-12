interface Props {
  label: string;
  value: string;
  caption?: string;
  highlight?: boolean; // acento neon — reservado para o KPI "hero" do card row
}

// Camada de Comando (Etapa 18) — cartão de KPI puro, sem lógica de busca.
// `highlight` é o único lugar que usa o azul neon como cor de destaque
// (borda + glow sutil), nunca como fundo cheio — mantém o fundo branco/chumbo
// pedido e o neon só como "detalhe".
export default function KpiCard({ label, value, caption, highlight }: Props) {
  return (
    <div
      className={[
        'rounded-2xl bg-surface p-5 shadow-card transition',
        highlight ? 'ring-1 ring-neon/60 shadow-neonGlow' : '',
      ].join(' ')}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-2 font-serif text-3xl font-semibold text-ink-900">{value}</p>
      {caption && <p className="mt-1 text-xs text-ink-500">{caption}</p>}
    </div>
  );
}
