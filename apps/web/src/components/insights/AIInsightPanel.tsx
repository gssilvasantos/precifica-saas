import type { SVGProps } from 'react';
import type { AIInsight } from '../../features/insights/types';
import { SEVERITY_META } from '../../features/insights/severity-meta';

interface Props {
  insights: AIInsight[];
}

// Painel dedicado do dashboard para a mesma fonte de dados do
// AIInsightBadge (features/insights/types.ts) — card discreto no fim da
// grade de KPIs, não um bloco gigante competindo com os números principais.
// Estado vazio é honesto: nenhum motor de sugestões existe ainda no
// backend, então isto é o ponto de extensão, não um placeholder fingindo
// dado real (mesmo padrão de honestidade usado em todo o resto do produto).
export default function AIInsightPanel({ insights }: Props) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neon/15 text-ink-900">
          <SparkIcon className="h-3.5 w-3.5" />
        </span>
        <h2 className="font-serif text-base font-semibold text-ink-900">Sugestões de IA</h2>
      </div>

      {insights.length === 0 && (
        <p className="rounded-lg bg-canvas px-4 py-6 text-center text-xs text-ink-500">
          Nenhuma sugestão ainda — este painel está pronto para receber recomendações (estoque, reprecificação,
          canais em risco) assim que o motor de inteligência estiver conectado.
        </p>
      )}

      {insights.length > 0 && (
        <ul className="space-y-3">
          {insights.map((insight) => {
            const meta = SEVERITY_META[insight.severity];
            return (
              <li key={insight.id} className="flex items-start gap-3 rounded-lg bg-canvas/60 px-3 py-2.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dotClass}`} />
                <div>
                  <span className={`text-[11px] font-semibold uppercase tracking-wide ${meta.textClass}`}>
                    {meta.label}
                  </span>
                  <p className="text-sm text-ink-700">{insight.message}</p>
                </div>
              </li>
            );
          })}
        </ul>
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
