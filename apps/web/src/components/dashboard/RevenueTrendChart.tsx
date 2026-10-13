import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyRevenuePoint } from '../../features/orders/dashboard-metrics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

interface Props {
  data: DailyRevenuePoint[];
}

// Reestruturação Visual WowDash (13/10/2026) — gráfico de área com receita
// bruta/líquida dos últimos N dias (ver computeDailyRevenueSeries). Cores
// vêm dos tokens de marca (--primary/--accent, já índigo) via CSS var lida
// em runtime do root, não um hex fixo — acompanha Light/Dark automaticamente.
// Dado 100% real (derivado de Order.orderedAt/totalAmount/netAmount), nunca
// mock: ver aviso de honestidade em dashboard-metrics.ts.
export default function RevenueTrendChart({ data }: Props) {
  const hasAnyRevenue = data.some((d) => d.revenue > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receita no período</CardTitle>
        <CardDescription>Bruta vs. líquida, últimos {data.length} dias — mesma amostra dos cards acima</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasAnyRevenue ? (
          <p className="flex h-56 items-center justify-center rounded-lg bg-muted text-center text-xs text-muted-foreground">
            Sem pedidos no período para desenhar a tendência.
          </p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revenueGross" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="revenueNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'rgb(var(--border))' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                  tickFormatter={(v: number) => currency.format(v)}
                />
                <Tooltip
                  formatter={(value: number, name) => [currency.format(value), name === 'revenue' ? 'Bruta' : 'Líquida']}
                  labelFormatter={(label) => `Dia ${label}`}
                  contentStyle={{
                    background: 'rgb(var(--card))',
                    border: '1px solid rgb(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="revenue" name="revenue" stroke="rgb(var(--accent))" strokeWidth={2} fill="url(#revenueGross)" />
                <Area type="monotone" dataKey="netAmount" name="netAmount" stroke="rgb(16 185 129)" strokeWidth={2} fill="url(#revenueNet)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
