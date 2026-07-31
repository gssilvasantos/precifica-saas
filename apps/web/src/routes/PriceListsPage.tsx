import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  createPriceList,
  deactivatePriceList,
  fetchPriceListExceptions,
  fetchPriceLists,
  removePriceListException,
  resolvePriceListPrice,
  setPriceListException,
  updatePriceList,
  type PriceList,
  type PriceListInput,
} from '../features/price-lists/api';
import { fetchProducts } from '../features/catalog/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function PriceListForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  initial?: PriceList;
  onSubmit: (input: PriceListInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [adjustmentPct, setAdjustmentPct] = useState(initial ? String(initial.adjustmentPct) : '');

  const canSubmit = name.trim() !== '' && Number.isFinite(Number(adjustmentPct)) && Number(adjustmentPct) > -100 && Number(adjustmentPct) <= 1000;

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">{initial ? 'Editar lista de preços' : 'Nova lista de preços'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Ajuste (%) — positivo = acréscimo, negativo = desconto
          <input type="number" step="0.01" value={adjustmentPct} onChange={(e) => setAdjustmentPct(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          disabled={!canSubmit || isSubmitting}
          onClick={() => onSubmit({ name: name.trim(), adjustmentPct: Number(adjustmentPct) })}
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

function PriceListExceptions({ list, canEdit }: { list: PriceList; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [productId, setProductId] = useState('');
  const [overridePrice, setOverridePrice] = useState('');
  const [testBasePrice, setTestBasePrice] = useState('');
  const [testProductId, setTestProductId] = useState('');
  const [resolvedPrice, setResolvedPrice] = useState<number | null>(null);

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const products = productsQuery.data ?? [];
  const exceptionsQuery = useQuery({
    queryKey: ['price-list-exceptions', list.id],
    queryFn: () => fetchPriceListExceptions(list.id),
  });
  const exceptions = exceptionsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['price-list-exceptions', list.id] });

  const setExceptionMutation = useMutation({
    mutationFn: () => setPriceListException(list.id, productId, Number(overridePrice)),
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setProductId('');
      setOverridePrice('');
    },
  });

  const removeExceptionMutation = useMutation({
    mutationFn: (pid: string) => removePriceListException(list.id, pid),
    onSuccess: invalidate,
  });

  const resolveMutation = useMutation({
    mutationFn: () => resolvePriceListPrice(list.id, testProductId, Number(testBasePrice)),
    onSuccess: (price) => setResolvedPrice(price),
  });

  const productName = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid;

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Exceções por produto</h4>
        {canEdit && !showAdd && (
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            Nova exceção
          </Button>
        )}
      </div>

      {showAdd && (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-foreground sm:col-span-2">
            Produto
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
              <option value="">Selecione…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.skuCode} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-foreground">
            Preço fixo (R$)
            <input type="number" min={0} step="0.01" value={overridePrice} onChange={(e) => setOverridePrice(e.target.value)} className={inputClass} />
          </label>
          <div className="sm:col-span-3 flex items-center gap-2">
            <Button
              size="sm"
              disabled={productId === '' || Number(overridePrice) <= 0 || setExceptionMutation.isPending}
              onClick={() => setExceptionMutation.mutate()}
            >
              {setExceptionMutation.isPending ? 'Salvando…' : 'Salvar exceção'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Cancelar
            </Button>
            {setExceptionMutation.isError && (
              <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(setExceptionMutation.error)}</span>
            )}
          </div>
        </div>
      )}

      {exceptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma exceção nesta lista.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <tbody>
            {exceptions.map((ex) => (
              <tr key={ex.id} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 pr-3 text-foreground">{productName(ex.productId)}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{currencyFormatter.format(ex.overridePrice)}</td>
                {canEdit && (
                  <td className="py-1.5 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover:border-margin-danger hover:text-margin-danger"
                      disabled={removeExceptionMutation.isPending}
                      onClick={() => removeExceptionMutation.mutate(ex.productId)}
                    >
                      Remover
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="text-xs font-medium text-foreground">Testar preço resolvido</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <select value={testProductId} onChange={(e) => setTestProductId(e.target.value)} className={inputClass + ' sm:col-span-2'}>
            <option value="">Produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.skuCode} — {p.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Preço base"
            value={testBasePrice}
            onChange={(e) => setTestBasePrice(e.target.value)}
            className={inputClass}
          />
          <Button
            size="sm"
            disabled={testProductId === '' || Number(testBasePrice) <= 0 || resolveMutation.isPending}
            onClick={() => resolveMutation.mutate()}
          >
            {resolveMutation.isPending ? 'Calculando…' : 'Calcular'}
          </Button>
        </div>
        {resolvedPrice !== null && (
          <p className="mt-2 text-sm font-medium text-foreground">Preço resolvido: {currencyFormatter.format(resolvedPrice)}</p>
        )}
      </div>
    </div>
  );
}

export default function PriceListsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: PriceList }>('closed');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listsQuery = useQuery({ queryKey: ['price-lists'], queryFn: fetchPriceLists });
  const lists = listsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['price-lists'] });

  const createMutation = useMutation({
    mutationFn: (input: PriceListInput) => createPriceList(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PriceListInput }) => updatePriceList(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivatePriceList(id),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Listas de Preço</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Percentual de ajuste aplicado sobre um preço base, com exceções pontuais por produto.
          </p>
        </div>
        {canEdit && formMode === 'closed' && <Button onClick={() => setFormMode('create')}>Nova lista</Button>}
      </div>

      {formMode === 'create' && (
        <PriceListForm
          onSubmit={(input) => createMutation.mutate(input)}
          onCancel={() => setFormMode('closed')}
          isSubmitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}
      {typeof formMode === 'object' && (
        <PriceListForm
          initial={formMode.edit}
          onSubmit={(input) => updateMutation.mutate({ id: formMode.edit.id, input })}
          onCancel={() => setFormMode('closed')}
          isSubmitting={updateMutation.isPending}
          error={updateMutation.error}
        />
      )}

      {listsQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!listsQuery.isLoading && lists.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma lista de preços cadastrada ainda.</p>}

      <div className="space-y-3">
        {lists.map((list) => (
          <Card key={list.id} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif text-base font-semibold text-foreground">{list.name}</h3>
                  <Badge variant={list.isActive ? 'success' : 'secondary'}>{list.isActive ? 'Ativa' : 'Inativa'}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ajuste: {list.adjustmentPct > 0 ? '+' : ''}
                  {list.adjustmentPct}%
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setExpandedId(expandedId === list.id ? null : list.id)}>
                  {expandedId === list.id ? 'Ocultar exceções' : 'Ver exceções'}
                </Button>
                {canEdit && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setFormMode({ edit: list })}>
                      Editar
                    </Button>
                    {list.isActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="hover:border-margin-danger hover:text-margin-danger"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(list.id)}
                      >
                        Desativar
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {expandedId === list.id && <PriceListExceptions list={list} canEdit={canEdit} />}
          </Card>
        ))}
      </div>
    </div>
  );
}
