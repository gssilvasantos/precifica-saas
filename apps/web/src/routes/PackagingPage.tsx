import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  PACKAGING_PURPOSE_LABEL,
  createPackaging,
  fetchPackagings,
  removePackaging,
  updatePackaging,
  type Packaging,
  type PackagingInput,
} from '../features/packaging/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyForm(): Record<keyof PackagingInput, string> {
  return { name: '', weightG: '', heightCm: '', widthCm: '', lengthCm: '', costPrice: '', stockQuantity: '' };
}

function PackagingForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  initial?: Packaging;
  onSubmit: (input: PackagingInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          weightG: String(initial.weightG),
          heightCm: String(initial.heightCm),
          widthCm: String(initial.widthCm),
          lengthCm: String(initial.lengthCm),
          costPrice: String(initial.costPrice),
          stockQuantity: String(initial.stockQuantity),
        }
      : emptyForm(),
  );

  const canSubmit =
    form.name.trim() !== '' &&
    Number(form.weightG) > 0 &&
    Number(form.heightCm) > 0 &&
    Number(form.widthCm) > 0 &&
    Number(form.lengthCm) > 0 &&
    Number(form.costPrice) > 0;

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">{initial ? 'Editar embalagem' : 'Nova embalagem'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-foreground sm:col-span-3">
          Nome
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Peso (g)
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.weightG}
            onChange={(e) => setForm((f) => ({ ...f, weightG: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Altura (cm)
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.heightCm}
            onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Largura (cm)
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.widthCm}
            onChange={(e) => setForm((f) => ({ ...f, widthCm: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Comprimento (cm)
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.lengthCm}
            onChange={(e) => setForm((f) => ({ ...f, lengthCm: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Custo (R$)
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.costPrice}
            onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Estoque (opcional)
          <input
            type="number"
            min={0}
            value={form.stockQuantity}
            onChange={(e) => setForm((f) => ({ ...f, stockQuantity: e.target.value }))}
            className={inputClass}
          />
        </label>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          disabled={!canSubmit || isSubmitting}
          onClick={() =>
            onSubmit({
              name: form.name.trim(),
              weightG: Number(form.weightG),
              heightCm: Number(form.heightCm),
              widthCm: Number(form.widthCm),
              lengthCm: Number(form.lengthCm),
              costPrice: Number(form.costPrice),
              stockQuantity: form.stockQuantity.trim() === '' ? undefined : Number(form.stockQuantity),
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

export default function PackagingPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: Packaging }>('closed');
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const packagingsQuery = useQuery({ queryKey: ['packagings'], queryFn: fetchPackagings });
  const packagings = packagingsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['packagings'] });

  const createMutation = useMutation({
    mutationFn: (input: PackagingInput) => createPackaging(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PackagingInput }) => updatePackaging(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removePackaging(id),
    onSuccess: () => {
      invalidate();
      setDeactivatingId(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Embalagens</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Usadas no custo efetivo do produto e nas dimensões de envio (sobrepõem as dimensões do produto quando
            vinculadas).
          </p>
        </div>
        {canEdit && formMode === 'closed' && <Button onClick={() => setFormMode('create')}>Nova embalagem</Button>}
      </div>

      {formMode === 'create' && (
        <PackagingForm
          onSubmit={(input) => createMutation.mutate(input)}
          onCancel={() => setFormMode('closed')}
          isSubmitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}
      {typeof formMode === 'object' && (
        <PackagingForm
          initial={formMode.edit}
          onSubmit={(input) => updateMutation.mutate({ id: formMode.edit.id, input })}
          onCancel={() => setFormMode('closed')}
          isSubmitting={updateMutation.isPending}
          error={updateMutation.error}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Finalidade</th>
                <th className="px-5 py-3 font-medium">Dimensões (A×L×C)</th>
                <th className="px-5 py-3 font-medium">Peso</th>
                <th className="px-5 py-3 font-medium">Custo</th>
                <th className="px-5 py-3 font-medium">Estoque</th>
                <th className="px-5 py-3 font-medium">Status</th>
                {canEdit && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {packagingsQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!packagingsQuery.isLoading && packagings.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhuma embalagem cadastrada ainda.
                  </td>
                </tr>
              )}
              {packagings.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{p.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{PACKAGING_PURPOSE_LABEL[p.purpose]}</td>
                  <td className="px-5 py-3 font-sans text-foreground">
                    {p.heightCm}×{p.widthCm}×{p.lengthCm} cm
                  </td>
                  <td className="px-5 py-3 font-sans text-foreground">{p.weightG} g</td>
                  <td className="px-5 py-3 font-sans text-foreground">{currencyFormatter.format(p.costPrice)}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{p.stockQuantity}</td>
                  <td className="px-5 py-3">
                    <Badge variant={p.isActive ? 'success' : 'secondary'}>{p.isActive ? 'Ativa' : 'Inativa'}</Badge>
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      {deactivatingId === p.id ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-margin-danger text-white hover:bg-margin-danger/90"
                            disabled={removeMutation.isPending}
                            onClick={() => removeMutation.mutate(p.id)}
                          >
                            {removeMutation.isPending ? 'Desativando…' : 'Confirmar'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeactivatingId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setFormMode({ edit: p })}>
                            Editar
                          </Button>
                          {p.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="hover:border-margin-danger hover:text-margin-danger"
                              onClick={() => setDeactivatingId(p.id)}
                            >
                              Desativar
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
