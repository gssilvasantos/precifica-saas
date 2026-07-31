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
import { Pagination } from '../ui/pagination';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';

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
        <Badge variant="accent" className="w-full justify-start gap-2 rounded-lg px-4 py-2 text-xs font-medium normal-case">
          Modo Demonstração ativo — os pedidos abaixo são fictícios (AuditSeederService), nunca dados reais da loja.
        </Badge>
      )}

      {/* Abas de status — contadores de uma única query agregada, nunca uma
          query por aba (docs/orders-architecture.md, seção 7). Retrofit
          shadcn/ui: pill com tokens semânticos (primary/muted) em vez de
          bg-ink-900/bg-canvas hardcoded, mesmo racional do Button ativo da
          Pagination — resolve Light/Dark sozinho. */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setStatus('');
            setPage(1);
          }}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition',
            status === '' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
          )}
        >
          Todos <span className={status === '' ? 'text-primary-foreground/70' : 'text-muted-foreground'}>({totalCount})</span>
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
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition',
                status === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.label}
              <span className={status === s ? 'text-primary-foreground/70' : 'text-muted-foreground'}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Filtro por canal — 7 marketplaces do hub (Etapa 17). */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Canal</label>
        <select
          value={channelCode}
          onChange={(e) => {
            setChannelCode(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate(selectedChannelMeta!.providerCode!)}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? 'Sincronizando… (pode levar minutos)' : 'Sincronizar agora'}
          </Button>
        )}
      </div>

      {syncMessage && <p className="text-xs text-muted-foreground">{syncMessage}</p>}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando pedidos…
                  </td>
                </tr>
              )}

              {!isLoading && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum pedido encontrado para este filtro.
                  </td>
                </tr>
              )}

              {orders.map((order) => {
                const deadlineAtRisk = isDeadlineAtRisk(order);
                const marginPct = order.totalAmount > 0 ? (order.netAmount / order.totalAmount) * 100 : null;
                const rowInsights = insightsFor(order);

                return (
                  <tr key={order.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <ChannelBadge channelCode={order.channelCode} size="sm" />
                    </td>
                    <td className="px-5 py-3 font-sans text-foreground">{order.externalOrderId}</td>
                    <td className="px-5 py-3 font-sans text-foreground">{dateFormatter.format(new Date(order.orderedAt))}</td>
                    <td className="px-5 py-3 font-sans">
                      {order.shippingDeadlineAt ? (
                        <span className={deadlineAtRisk ? 'font-semibold text-margin-danger' : 'text-foreground'}>
                          {dateFormatter.format(new Date(order.shippingDeadlineAt))}
                          {deadlineAtRisk && ' ⚠'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-sans text-foreground">{currency.format(order.totalAmount)}</td>
                    <td className="px-5 py-3 font-sans">
                      <span className="font-semibold text-foreground">{currency.format(order.netAmount)}</span>
                      {marginPct !== null && <span className="ml-1.5 text-xs text-muted-foreground">({marginPct.toFixed(1)}%)</span>}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>
                Página {page} de {totalPages} — {total} pedido(s)
              </span>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} className="text-xs" />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
