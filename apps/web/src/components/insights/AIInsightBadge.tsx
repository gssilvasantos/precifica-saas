import { useState, type SVGProps } from 'react';
import type { AIInsight } from '../../features/insights/types';
import { SEVERITY_META } from '../../features/insights/severity-meta';

interface Props {
  insights: AIInsight[];
}

// Resposta à pergunta 3 (dispor sugestões de IA sem poluir a tabela): em vez
// de uma coluna nova ou texto solto na linha, é um único ícone discreto que
// só aparece quando HÁ sugestão para aquele pedido/SKU, com um popover sob
// demanda (hover/click) — a densidade de informação da tabela não muda para
// os pedidos sem sugestão nenhuma (a maioria).
export default function AIInsightBadge({ insights }: Props) {
  const [open, setOpen] = useState(false);
  if (insights.length === 0) return null;

  const topSeverity = insights.some((i) => i.severity === 'OPORTUNIDADE')
    ? 'OPORTUNIDADE'
    : insights.some((i) => i.severity === 'ATENCAO')
      ? 'ATENCAO'
      : 'INFO';
  const meta = SEVERITY_META[topSeverity];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className={[
          'flex h-6 w-6 items-center justify-center rounded-full transition',
          topSeverity === 'OPORTUNIDADE' ? 'bg-neon/15 text-ink-900 hover:animate-neonPulse' : meta.badgeClass,
        ].join(' ')}
        aria-label={`${insights.length} sugestão(ões) de IA`}
        title="Sugestão de IA"
      >
        <SparkIcon className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-ink-300/60 bg-surface p-3 text-left shadow-card">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sugestões de IA</p>
          <ul className="space-y-2">
            {insights.map((insight) => {
              const itemMeta = SEVERITY_META[insight.severity];
              return (
                <li key={insight.id} className="flex items-start gap-2">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${itemMeta.dotClass}`} />
                  <span className="text-xs text-ink-700">{insight.message}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SparkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M10 2l1.7 4.9L17 8l-5.3 1.1L10 14l-1.7-4.9L3 8l5.3-1.1L10 2z" />
    </svg>
  );
}
