import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  assignVendedorToItem,
  createVendedor,
  fetchCommissions,
  fetchVendedores,
  generateCommissionPayout,
  setVendedorActive,
  updateVendedor,
  type Vendedor,
  type VendedorInput,
} from '../features/sellers/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function VendedorForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  initial?: Vendedor;
  onSubmit: (input: VendedorInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [aliquotaComissaoPct, setAliquotaComissaoPct] = useState(initial ? String(initial.aliquotaComissaoPct) : '');
  const [descontoMaximoPct, setDescontoMaximoPct] = useState(initial?.descontoMaximoPct !== undefined && initial?.descontoMaximoPct !== null ? String(initial.descontoMaximoPct) : '');

  const canSubmit = name.trim() !== '' && Number(aliquotaComissaoPct) >= 0 && Number(aliquotaComissaoPct) <= 100;

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">{initial ? 'Editar vendedor' : 'Novo vendedor'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          E-mail (opcional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Alíquota de comissão (%)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={aliquotaComissaoPct}
            onChange={(e) => setAliquotaComissaoPct(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Desconto máximo permitido (%, opcional)
          <input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={descontoMaximoPct}
            onChange={(e) => setDescontoMaximoPct(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          disabled={!canSubmit || isSubmitting}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              email: email.trim() === '' ? undefined : email.trim(),
              aliquotaComissaoPct: Number(aliquotaComissaoPct),
              descontoMaximoPct: descontoMaximoPct.trim() === '' ? undefined : Number(descontoMaximoPct),
            })
          }
        >
          {isSubmitting ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={onCancel}>
          Cancelar
        </Button>
        {error !== null && error !== undefined && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(error)}</span>}
      </div>
    </Card>
  );
}

function VendedorCommissionsPanel({ vendedor, canEdit, canGeneratePayout }: { vendedor: Vendedor; canEdit: boolean; canGeneratePayout: boolean }) {
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState('');
  const [itemId, setItemId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [payoutDueDate, setPayoutDueDate] = useState('');

  const commissionsQuery = useQuery({
    queryKey: ['commissions', vendedor.id, dateFrom, dateTo],
    queryFn: () => fetchCommissions(vendedor.id, dateFrom || undefined, dateTo || undefined),
  });
  const lines = commissionsQuery.data ?? [];
  const totalPending = lines.filter((l) => l.comissaoPagaEm === null).reduce((sum, l) => sum + l.valor, 0);

  const assignMutation = useMutation({
    mutationFn: () => assignVendedorToItem(vendedor.id, orderId.trim(), itemId.trim()),
    onSuccess: () => {
      setOrderId('');
      setItemId('');
      void queryClient.invalidateQueries({ queryKey: ['commissions', vendedor.id] });
    },
  });

  const payoutMutation = useMutation({
    mutationFn: () => generateCommissionPayout(vendedor.id, dateFrom, dateTo, payoutDueDate),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['commissions', vendedor.id] }),
  });

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      {canEdit && (
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">Atribuir vendedor a um item de pedido</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="ID do pedido" className={inputClass} />
            <input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="ID do item" className={inputClass} />
            <Button size="sm" disabled={orderId.trim() === '' || itemId.trim() === '' || assignMutation.isPending} onClick={() => assignMutation.mutate()}>
              {assignMutation.isPending ? 'Atribuindo…' : 'Atribuir'}
            </Button>
          </div>
          {assignMutation.isError && (
            <p className="mt-1 text-xs font-medium text-margin-danger">{extractErrorMessage(assignMutation.error)}</p>
          )}
          {assignMutation.isSuccess && <p className="mt-1 text-xs font-medium text-margin-good">Atribuído.</p>}
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-foreground">
            De
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="text-xs font-medium text-foreground">
            Até
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </label>
        </div>

        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Pedido</th>
              <th className="py-1.5 pr-3 font-medium">SKU</th>
              <th className="py-1.5 pr-3 font-medium">Base</th>
              <th className="py-1.5 pr-3 font-medium">Comissão</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {commissionsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {!commissionsQuery.isLoading && lines.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-center text-muted-foreground">
                  Nenhuma comissão neste período.
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.orderItemId} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3 text-foreground">{l.externalOrderId}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{l.skuCode ?? '—'}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{currencyFormatter.format(l.base)}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{currencyFormatter.format(l.valor)}</td>
                <td className="py-1.5 pr-3">
                  <Badge variant={l.comissaoPagaEm ? 'success' : 'accent'}>{l.comissaoPagaEm ? 'Paga' : 'Pendente'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {lines.length > 0 && (
          <p className="mt-2 text-xs font-medium text-foreground">Total pendente no período: {currencyFormatter.format(totalPending)}</p>
        )}
      </div>

      {canGeneratePayout && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-xs font-medium text-foreground">Gerar conta a pagar do repasse (comissões pendentes no período acima)</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-foreground">
              Vencimento
              <input type="date" value={payoutDueDate} onChange={(e) => setPayoutDueDate(e.target.value)} className={inputClass} />
            </label>
            <Button
              size="sm"
              disabled={dateFrom === '' || dateTo === '' || payoutDueDate === '' || payoutMutation.isPending}
              onClick={() => payoutMutation.mutate()}
            >
              {payoutMutation.isPending ? 'Gerando…' : 'Gerar conta a pagar'}
            </Button>
          </div>
          {payoutMutation.isError && (
            <p className="mt-1 text-xs font-medium text-margin-danger">{extractErrorMessage(payoutMutation.error)}</p>
          )}
          {payoutMutation.isSuccess && (
            <p className="mt-1 text-xs font-medium text-margin-good">
              Conta a pagar criada: {currencyFormatter.format(payoutMutation.data.amount)} ({payoutMutation.data.itemCount} item(ns)).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SellersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';
  const canGeneratePayout = user?.role === 'ADMIN';

  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: Vendedor }>('closed');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const vendedoresQuery = useQuery({ queryKey: ['vendedores'], queryFn: fetchVendedores });
  const vendedores = vendedoresQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['vendedores'] });

  const createMutation = useMutation({
    mutationFn: (input: VendedorInput) => createVendedor(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: VendedorInput }) => updateVendedor(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setVendedorActive(id, isActive),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Vendedores e Comissão</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cadastro de vendedor, atribuição a itens de pedido, relatório de comissão e geração da conta a pagar do
            repasse.
          </p>
          {!canGeneratePayout && (
            <p className="mt-2 text-xs text-muted-foreground">Gerar conta a pagar do repasse é restrito ao papel Administrador.</p>
          )}
        </div>
        {canEdit && formMode === 'closed' && <Button onClick={() => setFormMode('create')}>Novo vendedor</Button>}
      </div>

      {formMode === 'create' && (
        <VendedorForm
          onSubmit={(input) => createMutation.mutate(input)}
          onCancel={() => setFormMode('closed')}
          isSubmitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}
      {typeof formMode === 'object' && (
        <VendedorForm
          initial={formMode.edit}
          onSubmit={(input) => updateMutation.mutate({ id: formMode.edit.id, input })}
          onCancel={() => setFormMode('closed')}
          isSubmitting={updateMutation.isPending}
          error={updateMutation.error}
        />
      )}

      {vendedoresQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!vendedoresQuery.isLoading && vendedores.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vendedor cadastrado ainda.</p>}

      <div className="space-y-3">
        {vendedores.map((v) => (
          <Card key={v.id} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-base font-semibold text-foreground">{v.name}</h3>
                  <Badge variant={v.isActive ? 'success' : 'secondary'}>{v.isActive ? 'Ativo' : 'Inativo'}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Comissão: {v.aliquotaComissaoPct}% {v.email && `· ${v.email}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                  {expandedId === v.id ? 'Ocultar comissões' : 'Ver comissões'}
                </Button>
                {canEdit && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setFormMode({ edit: v })}>
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={v.isActive ? 'hover:border-margin-danger hover:text-margin-danger' : ''}
                      disabled={toggleActiveMutation.isPending}
                      onClick={() => toggleActiveMutation.mutate({ id: v.id, isActive: !v.isActive })}
                    >
                      {v.isActive ? 'Desativar' : 'Ativar'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {expandedId === v.id && <VendedorCommissionsPanel vendedor={v} canEdit={canEdit} canGeneratePayout={canGeneratePayout} />}
          </Card>
        ))}
      </div>
    </div>
  );
}
