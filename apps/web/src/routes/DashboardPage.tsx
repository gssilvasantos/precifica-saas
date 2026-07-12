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

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Camada de Comando (Etapa 18) — visão executiva agregando os widgets de
// performance pedidos (Receita, Margem, ROI por canal). Fonte de dado: a
// mesma tabela de pedidos normalizada do hub multicanal (GET /orders), sem
// endpoint de analytics dedicado ainda — ver aviso de honestidade em
// features/orders/dashboard-metrics.ts sobre o alcance dessa amostra e o
// que "ROI por canal" de fato significa aqui.
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
      <div className="relative overflow-hidden rounded-2xl bg-ink-900 px-6 py-8 text-white">
        <CircuitBackground />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neon">Kyneti · Camada de Comando</p>
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
        <div className="rounded-lg border border-neon/40 bg-neon/10 px-4 py-2 text-xs font-medium text-ink-700">
          Modo Demonstração ativo — os números abaixo vêm de pedidos fictícios (AuditSeederService), nunca dos dados
          reais da Rita Mazzei Beauty.
        </div>
      )}

      {isLoading && (
        <div className="rounded-2xl bg-surface p-8 text-center text-sm text-ink-500 shadow-card">
          Carregando dashboard…
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
