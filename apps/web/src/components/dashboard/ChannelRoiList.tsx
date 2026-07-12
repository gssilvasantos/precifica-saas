import type { ChannelPerformance } from '../../features/orders/dashboard-metrics';
import { getChannelMeta } from '../../features/orders/channels';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface Props {
  channels: ChannelPerformance[];
}

// ROI por canal — barra proporcional à receita bruta do canal, com o %
// líquido (proxy de ROI, ver aviso em dashboard-metrics.ts) ao lado. Ordenado
// por receita desc — o canal que mais vende aparece primeiro, decisão rápida
// em cima da hora (pedido explícito do usuário: "priorizar tomada de decisão
// rápida").
export default function ChannelRoiList({ channels }: Props) {
  const maxRevenue = Math.max(1, ...channels.map((c) => c.revenue));

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-base font-semibold text-ink-900">ROI por canal</h2>
        <span className="text-[11px] text-ink-500">valor líquido / valor bruto</span>
      </div>

      {channels.length === 0 && (
        <p className="rounded-lg bg-canvas px-4 py-6 text-center text-xs text-ink-500">
          Sem pedidos ainda para calcular performance por canal.
        </p>
      )}

      <ul className="space-y-4">
        {channels.map((channel) => {
          const meta = getChannelMeta(channel.channelCode);
          const widthPct = (channel.revenue / maxRevenue) * 100;
          return (
            <li key={channel.channelCode}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-ink-900">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                    style={{ backgroundColor: meta.brandColor, color: meta.brandInk }}
                  >
                    {meta.initial}
                  </span>
                  {meta.label}
                </span>
                <span className="font-sans text-ink-700">
                  {currency.format(channel.revenue)}
                  {channel.marginPct !== null && (
                    <span className="ml-1.5 text-xs text-ink-500">({channel.marginPct.toFixed(1)}%)</span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-ink-300/40">
                <div className="h-full rounded-full bg-neon" style={{ width: `${widthPct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
