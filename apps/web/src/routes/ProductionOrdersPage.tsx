import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  cancelProductionOrder,
  concludeProductionOrder,
  createProductionOrder,
  fetchProductionOrders,
  startProductionOrder,
  type CreateProductionOrderInput,
  type ProductionOrder,
  type ProductionOrderStatus,
} from '../features/production/api';
import { fetchWarehouses } from '../features/logistics-fulfillment/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function StatusBadge({ status }: { status: ProductionOrderStatus }) {
  if (status === 'CONCLUIDA') return <Badge variant="success">Concluída</Badge>;
  if (status === 'CANCELADA') return <Badge variant="secondary">Cancelada</Badge>;
  if (status === 'EM_ANDAMENTO') return <Badge variant="warning">Em andamento</Badge>;
  return <Badge variant="accent">Rascunho</Badge>;
}

function CreateProductionOrderForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const warehousesQuery = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const warehouses = warehousesQuery.data ?? [];

  const [parentSkuCode, setParentSkuCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState('');
  const [notes, setNotes] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: CreateProductionOrderInput) => createProductionOrder(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      onDone();
    },
  });

  const canSubmit = parentSkuCode.trim() !== '' && Number(quantity) > 0 && sourceWarehouseId !== '' && destinationWarehouseId !== '';

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Nova ordem de produção</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        O produto acabado precisa ter a estrutura (BOM) já cadastrada em Produtos — a conclusão debita os componentes
        e credita o produto acabado automaticamente.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          SKU do produto acabado
          <input value={parentSkuCode} onChange={(e) => setParentSkuCode(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Quantidade a produzir
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Depósito de origem (componentes)
          <select value={sourceWarehouseId} onChange={(e) => setSourceWarehouseId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Depósito de destino (produto acabado)
          <select value={destinationWarehouseId} onChange={(e) => setDestinationWarehouseId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground sm:col-span-2">
          Observações (opcional)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          disabled={!canSubmit || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              parentSkuCode: parentSkuCode.trim(),
              quantity: Number(quantity),
              sourceWarehouseId,
              destinationWarehouseId,
              notes: notes.trim() === '' ? undefined : notes.trim(),
            })
          }
        >
          {createMutation.isPending ? 'Criando…' : 'Criar ordem de produção'}
        </Button>
        <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function ProductionOrderRow({ order, canEdit }: { order: ProductionOrder; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['production-orders'] });
  const startMutation = useMutation({ mutationFn: () => startProductionOrder(order.id), onSuccess: invalidate });
  const concludeMutation = useMutation({ mutationFn: () => concludeProductionOrder(order.id), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: () => cancelProductionOrder(order.id), onSuccess: invalidate });

  const canStart = order.status === 'RASCUNHO';
  const canConclude = order.status === 'RASCUNHO' || order.status === 'EM_ANDAMENTO';
  const canCancel = order.status === 'RASCUNHO' || order.status === 'EM_ANDAMENTO';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold text-foreground">
              {order.parentSkuCode} × {order.quantity}
            </h3>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Criada em {dateFormatter.format(new Date(order.createdAt))}
            {order.concludedAt && ` · Concluída em ${dateFormatter.format(new Date(order.concludedAt))}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar componentes' : 'Ver componentes'}
          </Button>
          {canEdit && canStart && (
            <Button variant="outline" size="sm" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
              Iniciar produção
            </Button>
          )}
          {canEdit && canConclude && (
            <Button size="sm" disabled={concludeMutation.isPending} onClick={() => concludeMutation.mutate()}>
              {concludeMutation.isPending ? 'Concluindo…' : 'Concluir'}
            </Button>
          )}
          {canEdit && canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="hover:border-margin-danger hover:text-margin-danger"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancelar
            </Button>
          )}
        </div>
      </div>

      {(startMutation.isError || concludeMutation.isError || cancelMutation.isError) && (
        <p className="mt-2 text-xs font-medium text-margin-danger">
          {extractErrorMessage(startMutation.error ?? concludeMutation.error ?? cancelMutation.error)}
        </p>
      )}

      {expanded && (
        <table className="mt-3 w-full border-t border-border pt-2 text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Componente</th>
              <th className="py-1.5 pr-3 font-medium">Por unidade</th>
              <th className="py-1.5 pr-3 font-medium">Total necessário</th>
            </tr>
          </thead>
          <tbody>
            {order.components.map((c) => (
              <tr key={c.id} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{c.componentSkuCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{c.quantityPerUnit}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{c.totalQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function ProductionOrdersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [statusFilter, setStatusFilter] = useState<ProductionOrderStatus | ''>('');
  const [showForm, setShowForm] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['production-orders', statusFilter],
    queryFn: () => fetchProductionOrders(statusFilter === '' ? undefined : statusFilter),
  });
  const orders = ordersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Ordens de Produção</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Iniciar e concluir produção a partir da estrutura de produto (BOM) já cadastrada em Produtos.
          </p>
        </div>
        {canEdit && !showForm && <Button onClick={() => setShowForm(true)}>Nova ordem de produção</Button>}
      </div>

      {showForm && <CreateProductionOrderForm onDone={() => setShowForm(false)} />}

      <label className="text-xs font-medium text-foreground">
        Status
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProductionOrderStatus | '')}
          className="ml-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todos</option>
          <option value="RASCUNHO">Rascunho</option>
          <option value="EM_ANDAMENTO">Em andamento</option>
          <option value="CONCLUIDA">Concluída</option>
          <option value="CANCELADA">Cancelada</option>
        </select>
      </label>

      <div className="space-y-3">
        {ordersQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!ordersQuery.isLoading && orders.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ordem de produção ainda.</p>}
        {orders.map((order) => (
          <ProductionOrderRow key={order.id} order={order} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
