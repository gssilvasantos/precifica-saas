import type { ChannelPerformance } from '../../features/orders/dashboard-metrics';
import { getChannelMeta } from '../../features/orders/channels';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface Props {
  channels: ChannelPerformance[];
}

// ROI por canal — barra proporcional à receita bruta do canal, com o %
// líquido (proxy de ROI, ver aviso em dashboard-metrics.ts) ao lado. Ordenado
// por receita desc — o canal que mais vende aparece primeiro, decisão rápida
// em cima da hora (pedido explícito do usuário: "priorizar tomada de decisão
// rápida"). Migrado para Card; a barra em si continua custom (Progress do
// shadcn ainda não foi trazido — ver próximos retrofits).
export default function ChannelRoiList({ channels }: Props) {
  const maxRevenue = Math.max(1, ...channels.map((c) => c.revenue));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>ROI por canal</CardTitle>
        <span className="text-[11px] text-muted-foreground">valor líquido / valor bruto</span>
      </CardHeader>
      <CardContent>
        {channels.length === 0 && (
          <p className="rounded-lg bg-muted px-4 py-6 text-center text-xs text-muted-foreground">
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
                  <span className="flex items-center gap-2 font-medium text-foreground">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                      style={{ backgroundColor: meta.brandColor, color: meta.brandInk }}
                    >
                      {meta.initial}
                    </span>
                    {meta.label}
                  </span>
                  <span className="font-sans text-muted-foreground">
                    {currency.format(channel.revenue)}
                    {channel.marginPct !== null && <span className="ml-1.5 text-xs">({channel.marginPct.toFixed(1)}%)</span>}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${widthPct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
