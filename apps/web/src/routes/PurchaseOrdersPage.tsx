import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  advancePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  fetchPurchaseOrders,
  receivePurchaseOrder,
  type CreatePurchaseOrderInput,
  type PurchaseOrder,
  type PurchaseOrderItemInput,
  type PurchaseOrderStatus,
} from '../features/procurement/api';
import { fetchSuppliers } from '../features/suppliers/api';
import { fetchWarehouses } from '../features/logistics-fulfillment/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  if (status === 'ATENDIDO') return <Badge variant="success">Atendido</Badge>;
  if (status === 'CANCELADO') return <Badge variant="secondary">Cancelado</Badge>;
  if (status === 'ANDAMENTO') return <Badge variant="warning">Em andamento</Badge>;
  return <Badge variant="accent">Aberto</Badge>;
}

function emptyItem(): PurchaseOrderItemInput {
  return { skuCode: '', quantity: 1, unitCost: 0, ipi: undefined };
}

function computeTotal(items: { quantity: number; unitCost: number; ipi?: number | null }[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitCost + (i.ipi ?? 0), 0);
}

function CreatePurchaseOrderForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: fetchSuppliers });
  const warehousesQuery = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const suppliers = (suppliersQuery.data ?? []).filter((s) => s.isActive);
  const warehouses = warehousesQuery.data ?? [];

  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [paymentDueDate, setPaymentDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseOrderItemInput[]>([emptyItem()]);

  const createMutation = useMutation({
    mutationFn: (input: CreatePurchaseOrderInput) => createPurchaseOrder(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onDone();
    },
  });

  const updateItem = (index: number, patch: Partial<PurchaseOrderItemInput>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const canSubmit =
    supplierId !== '' &&
    warehouseId !== '' &&
    paymentDueDate !== '' &&
    items.length > 0 &&
    items.every((i) => i.skuCode.trim() !== '' && i.quantity > 0 && i.unitCost >= 0);

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Nova ordem de compra</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-foreground">
          Fornecedor
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Depósito de destino
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Vencimento do pagamento
          <input type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground sm:col-span-3">
          Observações (opcional)
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium text-foreground">Itens</p>
        <div className="mt-2 space-y-2">
          {items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-5">
              <input
                value={item.skuCode}
                onChange={(e) => updateItem(index, { skuCode: e.target.value })}
                placeholder="SKU"
                className={inputClass}
              />
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                placeholder="Quantidade"
                className={inputClass}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={item.unitCost}
                onChange={(e) => updateItem(index, { unitCost: Number(e.target.value) })}
                placeholder="Custo unitário"
                className={inputClass}
              />
              <input
                type="number"
                min={0}
                step="0.01"
                value={item.ipi ?? ''}
                onChange={(e) => updateItem(index, { ipi: e.target.value === '' ? undefined : Number(e.target.value) })}
                placeholder="IPI (opcional)"
                className={inputClass}
              />
              <Button
                variant="outline"
                size="sm"
                className="hover:border-margin-danger hover:text-margin-danger"
                disabled={items.length === 1}
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              >
                Remover
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          Adicionar item
        </Button>
        <p className="mt-2 text-sm font-medium text-foreground">Total estimado: {currencyFormatter.format(computeTotal(items))}</p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          disabled={!canSubmit || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              supplierId,
              warehouseId,
              paymentDueDate,
              notes: notes.trim() === '' ? undefined : notes.trim(),
              items,
            })
          }
        >
          {createMutation.isPending ? 'Criando…' : 'Criar ordem de compra'}
        </Button>
        <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function PurchaseOrderRow({ order, canEdit }: { order: PurchaseOrder; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [showReceive, setShowReceive] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });

  const advanceMutation = useMutation({ mutationFn: () => advancePurchaseOrder(order.id), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: () => cancelPurchaseOrder(order.id), onSuccess: invalidate });
  const receiveMutation = useMutation({
    mutationFn: () => receivePurchaseOrder(order.id, invoiceNumber.trim()),
    onSuccess: () => {
      invalidate();
      setShowReceive(false);
    },
  });

  const total = computeTotal(order.items);
  const canAdvance = order.status === 'ABERTO';
  const canReceive = order.status === 'ABERTO' || order.status === 'ANDAMENTO';
  const canCancel = order.status === 'ABERTO' || order.status === 'ANDAMENTO';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold text-foreground">OC {order.id.slice(0, 8)}</h3>
            <StatusBadge status={order.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Vencimento: {dateFormatter.format(new Date(order.paymentDueDate))} · Total: {currencyFormatter.format(total)}
            {order.invoiceNumber && ` · NF ${order.invoiceNumber}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar itens' : 'Ver itens'}
          </Button>
          {canEdit && canAdvance && (
            <Button variant="outline" size="sm" disabled={advanceMutation.isPending} onClick={() => advanceMutation.mutate()}>
              Avançar p/ Andamento
            </Button>
          )}
          {canEdit && canReceive && !showReceive && (
            <Button size="sm" onClick={() => setShowReceive(true)}>
              Receber
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

      {showReceive && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="Número da NF do fornecedor"
            className={inputClass + ' max-w-xs'}
          />
          <Button size="sm" disabled={invoiceNumber.trim() === '' || receiveMutation.isPending} onClick={() => receiveMutation.mutate()}>
            {receiveMutation.isPending ? 'Recebendo…' : 'Confirmar recebimento'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowReceive(false)}>
            Cancelar
          </Button>
          {receiveMutation.isError && (
            <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(receiveMutation.error)}</span>
          )}
        </div>
      )}
      {(advanceMutation.isError || cancelMutation.isError) && (
        <p className="mt-2 text-xs font-medium text-margin-danger">
          {extractErrorMessage(advanceMutation.error ?? cancelMutation.error)}
        </p>
      )}

      {expanded && (
        <table className="mt-3 w-full border-t border-border pt-2 text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">SKU</th>
              <th className="py-1.5 pr-3 font-medium">Quantidade</th>
              <th className="py-1.5 pr-3 font-medium">Custo unit.</th>
              <th className="py-1.5 pr-3 font-medium">IPI</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{item.skuCode}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{item.quantity}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{currencyFormatter.format(item.unitCost)}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{item.ipi !== null ? currencyFormatter.format(item.ipi) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('');
  const [showForm, setShowForm] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => fetchPurchaseOrders(statusFilter === '' ? undefined : { status: statusFilter }),
  });
  const orders = ordersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Ordens de Compra</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Emitir OC para fornecedor, acompanhar status e receber — recebimento credita estoque e lança a conta a
            pagar automaticamente.
          </p>
        </div>
        {canEdit && !showForm && <Button onClick={() => setShowForm(true)}>Nova ordem de compra</Button>}
      </div>

      {showForm && <CreatePurchaseOrderForm onDone={() => setShowForm(false)} />}

      <label className="text-xs font-medium text-foreground">
        Status
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PurchaseOrderStatus | '')}
          className="ml-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Todos</option>
          <option value="ABERTO">Aberto</option>
          <option value="ANDAMENTO">Em andamento</option>
          <option value="ATENDIDO">Atendido</option>
          <option value="CANCELADO">Cancelado</option>
        </select>
      </label>

      <div className="space-y-3">
        {ordersQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!ordersQuery.isLoading && orders.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ordem de compra ainda.</p>}
        {orders.map((order) => (
          <PurchaseOrderRow key={order.id} order={order} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
