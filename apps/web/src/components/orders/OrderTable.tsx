import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrders, fetchOrderStatusCounts, triggerOrderSync, type Order, type OrderStatus } from '../../features/orders/api';
import { ORDER_CHANNELS } from '../../features/orders/channels';
import { ORDER_STATUS_META, ORDER_STATUS_TABS } from '../../features/orders/status-meta';
import { useAppMode } from '../../features/app-mode/app-mode-context';
import type { AIInsight } from '../../features/insights/types';
import ChannelBadge from './ChannelBadge';
import OrderStatusBadge from './OrderStatusBadge';
import AIInsightBadge from '../insights/AIInsightBadge';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const TERMINAL_NO_DEADLINE_RISK: OrderStatus[] = ['ENVIADO', 'ENTREGUE', 'CANCELADO'];
const PAGE_SIZE = 50;

interface Props {
  // Sugestões de IA já carregadas pela página-mãe (ver Dashboard/OrdersPage)
  // — o componente só casa por orderId; nunca busca isso sozinho (a origem
  // do dado é decidida por quem usa a tabela, não pela tabela).
  insights?: AIInsight[];
}

// Tabela de pedidos unificada (docs/orders-architecture.md, seção 7) —
// consome o mesmo payload normalizado que `RawOrderCandidate` alimenta
// (Order, já com status/valores traduzidos pelo adapter do canal). Filtros
// de canal + abas de status + paginação real no banco (nunca filtro em
// memória) — mesma disciplina de performance documentada na arquitetura.
export default function OrderTable({ insights = [] }: Props) {
  const { mode } = useAppMode();
  const queryClient = useQueryClient();
  const [channelCode, setChannelCode] = useState<string>('');
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const filters = useMemo(
    () => ({ channelCode: channelCode || undefined, status: status || undefined, mode }),
    [channelCode, status, mode],
  );

  // `mode` entra na queryKey de propósito (Audit Mode, ver docs/audit-mode.md)
  // — trocar REAL/DEMO precisa invalidar o cache da tabela, nunca reaproveitar
  // uma página já carregada do outro modo.
  const ordersQuery = useQuery({
    queryKey: ['orders', filters, page],
    queryFn: () => fetchOrders(filters, page, PAGE_SIZE),
  });
  // channelCode entra na queryKey (bug de produção 26/07/2026, ver
  // features/orders/api.ts): antes disso, a contagem das abas nunca
  // respeitava o canal selecionado no dropdown abaixo.
  const countsQuery = useQuery({
    queryKey: ['orders-status-counts', mode, channelCode],
    queryFn: () => fetchOrderStatusCounts(mode, channelCode || undefined),
  });
  const totalCount = countsQuery.data
    ? Object.values(countsQuery.data).reduce((sum, n) => sum + n, 0)
    : 0;

  const selectedChannelMeta = channelCode ? ORDER_CHANNELS.find((c) => c.code === channelCode) : undefined;
  const canSyncSelectedChannel = Boolean(selectedChannelMeta?.providerCode);

  // "Sincronizar agora" (24/07/2026) — genérico para qualquer canal com
  // provider real (providerCode presente em ORDER_CHANNELS), não um botão
  // dedicado a um card de Integrações. AVISO: o endpoint espera a
  // sincronização terminar antes de responder — para um canal com muito
  // histórico e rate limit conservador, isso pode levar MINUTOS (ver
  // mercado-livre-api.client.ts) — por isso a mensagem abaixo é explícita
  // sobre não travar/recarregar enquanto espera.
  const syncMutation = useMutation({
    mutationFn: triggerOrderSync,
    onMutate: () => setSyncMessage(null),
    onSuccess: () => {
      setSyncMessage(`Sincronização de ${selectedChannelMeta?.label ?? 'canal'} concluída — atualizando pedidos.`);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['orders-status-counts'] });
    },
    onError: () => setSyncMessage('Falha ao sincronizar — tente novamente em instantes.'),
  });

  const orders = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isLoading = ordersQuery.isLoading;

  function insightsFor(order: Order): AIInsight[] {
    return insights.filter(
      (i) => i.orderId === order.id || (i.channelCode && i.channelCode === order.channelCode && !i.orderId),
    );
  }

  function isDeadlineAtRisk(order: Order): boolean {
    if (!order.shippingDeadlineAt || TERMINAL_NO_DEADLINE_RISK.includes(order.status)) return false;
    return new Date(order.shippingDeadlineAt).getTime() < Date.now();
  }

  return (
    <div className="space-y-4">
      {mode === 'DEMO' && (
        <div className="rounded-lg border border-neon/40 bg-neon/10 px-4 py-2 text-xs font-medium text-ink-700">
          Modo Demonstração ativo — os pedidos abaixo são fictícios (AuditSeederService), nunca dados reais da loja.
        </div>
      )}

      {/* Abas de status — contadores de uma única query agregada, nunca uma
          query por aba (docs/orders-architecture.md, seção 7). */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
          className={[
            'rounded-full px-3 py-1.5 text-xs font-medium transition',
            status === '' ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-700 hover:bg-ink-300/40',
          ].join(' ')}
        >
          Todos <span className={status === '' ? 'text-white/70' : 'text-ink-500'}>({totalCount})</span>
        </button>
        {ORDER_STATUS_TABS.map((s) => {
          const meta = ORDER_STATUS_META[s];
          const count = countsQuery.data?.[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              className={[
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                status === s ? 'bg-ink-900 text-white' : 'bg-canvas text-ink-700 hover:bg-ink-300/40',
              ].join(' ')}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.label}
              <span className="text-ink-500">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Filtro por canal — 7 marketplaces do hub (Etapa 17). */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">Canal</label>
        <select
          value={channelCode}
          onChange={(e) => {
            setChannelCode(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-ink-300 bg-surface px-3 py-1.5 text-sm text-ink-900 focus:border-neon focus:outline-none focus:ring-1 focus:ring-neon"
        >
          <option value="">Todos os canais</option>
          {ORDER_CHANNELS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
              {!c.implemented ? ' (em breve)' : ''}
            </option>
          ))}
        </select>

        {/* "Sincronizar agora" — só aparece com um canal com sync real
            selecionado (nunca em "Todos os canais", que misturaria vários
            providers numa única chamada). Genérico por design: funciona
            para qualquer canal com providerCode, não só Mercado Livre. */}
        {canSyncSelectedChannel && (
          <button
            onClick={() => syncMutation.mutate(selectedChannelMeta!.providerCode!)}
            disabled={syncMutation.isPending}
            className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:border-neon hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncMutation.isPending ? 'Sincronizando… (pode levar minutos)' : 'Sincronizar agora'}
          </button>
        )}
      </div>

      {syncMessage && (
        <p className="text-xs text-ink-500">{syncMessage}</p>
      )}

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Canal</th>
              <th className="px-5 py-3 font-medium">Pedido</th>
              <th className="px-5 py-3 font-medium">Data</th>
              <th className="px-5 py-3 font-medium">Prazo de despacho</th>
              <th className="px-5 py-3 font-medium">Valor total</th>
              <th className="px-5 py-3 font-medium">Valor líquido (margem)</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
                  Carregando pedidos…
                </td>
              </tr>
            )}

            {!isLoading && orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-ink-500">
                  Nenhum pedido encontrado para este filtro.
                </td>
              </tr>
            )}

            {orders.map((order) => {
              const deadlineAtRisk = isDeadlineAtRisk(order);
              const marginPct = order.totalAmount > 0 ? (order.netAmount / order.totalAmount) * 100 : null;
              const rowInsights = insightsFor(order);

              return (
                <tr key={order.id} className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                  <td className="px-5 py-3">
                    <ChannelBadge channelCode={order.channelCode} size="sm" />
                  </td>
                  <td className="px-5 py-3 font-sans text-ink-700">{order.externalOrderId}</td>
                  <td className="px-5 py-3 font-sans text-ink-700">{dateFormatter.format(new Date(order.orderedAt))}</td>
                  <td className="px-5 py-3 font-sans">
                    {order.shippingDeadlineAt ? (
                      <span className={deadlineAtRisk ? 'font-semibold text-margin-danger' : 'text-ink-700'}>
                        {dateFormatter.format(new Date(order.shippingDeadlineAt))}
                        {deadlineAtRisk && ' ⚠'}
                      </span>
                    ) : (
                      <span className="text-ink-500">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-sans text-ink-700">{currency.format(order.totalAmount)}</td>
                  <td className="px-5 py-3 font-sans">
                    <span className="font-semibold text-ink-900">{currency.format(order.netAmount)}</span>
                    {marginPct !== null && <span className="ml-1.5 text-xs text-ink-500">({marginPct.toFixed(1)}%)</span>}
                  </td>
                  <td className="px-5 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <AIInsightBadge insights={rowInsights} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-ink-300/60 px-5 py-3 text-xs text-ink-500">
            <span>
              Página {page} de {totalPages} — {total} pedido(s)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-ink-300 px-3 py-1 font-medium text-ink-700 transition hover:border-neon disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg border border-ink-300 px-3 py-1 font-medium text-ink-700 transition hover:border-neon disabled:cursor-not-allowed disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
