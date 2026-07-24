import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../features/orders/api';
import { computeDashboardMetrics } from '../features/orders/dashboard-metrics';
import { useAppMode } from '../features/app-mode/app-mode-context';
import KpiCard from '../components/dashboard/KpiCard';
import ChannelRoiList from '../components/dashboard/ChannelRoiList';
import CircuitBackground from '../components/dashboard/CircuitBackground';
import AIInsightPanel from '../components/insights/AIInsightPanel';
import AppModeToggle from '../components/dashboard/AppModeToggle';
import { Skeleton } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Camada de Comando (Etapa 18) — visão executiva agregando os widgets de
// performance pedidos (Receita, Margem, ROI por canal). Fonte de dado: a
// mesma tabela de pedidos normalizada do hub multicanal (GET /orders), sem
// endpoint de analytics dedicado ainda — ver aviso de honestidade em
// features/orders/dashboard-metrics.ts sobre o alcance dessa amostra e o
// que "ROI por canal" de fato significa aqui.
//
// Vitrine da identidade Kyneti (pedido do usuário): hero escuro +
// CircuitBackground continuam a peça central em AMBOS os temas — no Light
// Mode ele já era o único bloco grafite da tela; no Dark Mode ele se funde
// com o resto do fundo (mesma família ink-950/900), então o glow de neon é
// quem carrega o contraste visual, não mais uma "ilha escura" isolada.
export default function DashboardPage() {
  const { mode } = useAppMode();
  // `mode` na queryKey (Audit Mode, ver docs/audit-mode.md) — trocar
  // REAL/DEMO nunca reaproveita a amostra do outro modo.
  const ordersQuery = useQuery({
    queryKey: ['orders', 'dashboard-sample', mode],
    queryFn: () => fetchOrders({ mode }, 1, 200),
  });

  const orders = ordersQuery.data?.items ?? [];
  const metrics = useMemo(() => computeDashboardMetrics(orders), [orders]);
  const isLoading = ordersQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-ink-950 px-6 py-8 text-white">
        <CircuitBackground />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">Kyneti · Camada de Comando</p>
            <h1 className="mt-1 font-serif text-2xl font-semibold text-white md:text-3xl">Dashboard</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Receita, margem e performance por canal em uma visão rápida — para decisões de precificação e estoque
              sem precisar abrir cada pedido.
            </p>
          </div>
          {/* Botão discreto, só visível/ativo para Admin — ver AppModeToggle
              e docs/audit-mode.md. Fica no canto do hero, não no fluxo
              principal de leitura da tela. */}
          <AppModeToggle />
        </div>
      </div>

      {mode === 'DEMO' && (
        <Badge variant="accent" className="w-full justify-start gap-2 rounded-lg px-4 py-2 text-xs font-medium normal-case">
          Modo Demonstração ativo — os números abaixo vêm de pedidos fictícios (dados sintéticos de teste), nunca dos
          dados reais do tenant.
        </Badge>
      )}

      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-8 w-28" />
                <Skeleton className="mt-2 h-3 w-32" />
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <Skeleton className="h-4 w-28" />
              <div className="mt-4 space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-4 h-20 w-full" />
            </Card>
          </div>
        </div>
      )}

      {!isLoading && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Receita bruta" value={currency.format(metrics.grossRevenue)} caption="Amostra: últimos pedidos ativos" />
            <KpiCard
              label="Receita líquida"
              value={currency.format(metrics.netRevenue)}
              caption="Já descontada a comissão de cada canal"
              highlight
            />
            <KpiCard
              label="Margem média"
              value={metrics.averageMarginPct !== null ? `${metrics.averageMarginPct.toFixed(1)}%` : '—'}
              caption="Líquido / bruto, ponderado pelos pedidos"
            />
            <KpiCard label="Pedidos ativos" value={String(metrics.activeOrderCount)} caption="Excluindo cancelados" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChannelRoiList channels={metrics.channels} />
            </div>
            <AIInsightPanel insights={[]} />
          </div>
        </>
      )}
    </div>
  );
}
