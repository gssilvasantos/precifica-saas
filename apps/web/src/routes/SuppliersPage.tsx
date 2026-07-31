import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  createSupplier,
  fetchSuppliers,
  removeSupplier,
  updateSupplier,
  type Supplier,
  type SupplierInput,
} from '../features/suppliers/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyForm(): SupplierInput {
  return { name: '', contact: '', leadTimeDays: undefined, paymentTerms: '' };
}

function SupplierForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: {
  initial?: Supplier;
  onSubmit: (input: SupplierInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<SupplierInput>(
    initial
      ? {
          name: initial.name,
          contact: initial.contact ?? '',
          leadTimeDays: initial.leadTimeDays ?? undefined,
          paymentTerms: initial.paymentTerms ?? '',
        }
      : emptyForm(),
  );

  const canSubmit = form.name.trim() !== '';

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">{initial ? 'Editar fornecedor' : 'Novo fornecedor'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground sm:col-span-2">
          Nome
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Contato (opcional)
          <input
            value={form.contact ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
            placeholder="E-mail ou telefone"
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Lead time (dias, opcional)
          <input
            type="number"
            min={0}
            value={form.leadTimeDays ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: e.target.value === '' ? undefined : Number(e.target.value) }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground sm:col-span-2">
          Condições de pagamento (opcional)
          <input
            value={form.paymentTerms ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
            placeholder="Ex.: 30/60/90 dias"
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
              contact: form.contact?.trim() || undefined,
              leadTimeDays: form.leadTimeDays,
              paymentTerms: form.paymentTerms?.trim() || undefined,
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

export default function SuppliersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: Supplier }>('closed');
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: fetchSuppliers });
  const suppliers = suppliersQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  const createMutation = useMutation({
    mutationFn: (input: SupplierInput) => createSupplier(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SupplierInput }) => updateSupplier(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeSupplier(id),
    onSuccess: () => {
      invalidate();
      setDeactivatingId(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Fornecedores</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cadastro usado em Ordem de Compra — nome, contato, lead time e condições de pagamento.
          </p>
        </div>
        {canEdit && formMode === 'closed' && <Button onClick={() => setFormMode('create')}>Novo fornecedor</Button>}
      </div>

      {formMode === 'create' && (
        <SupplierForm
          onSubmit={(input) => createMutation.mutate(input)}
          onCancel={() => setFormMode('closed')}
          isSubmitting={createMutation.isPending}
          error={createMutation.error}
        />
      )}
      {typeof formMode === 'object' && (
        <SupplierForm
          initial={formMode.edit}
          onSubmit={(input) => updateMutation.mutate({ id: formMode.edit.id, input })}
          onCancel={() => setFormMode('closed')}
          isSubmitting={updateMutation.isPending}
          error={updateMutation.error}
        />
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Contato</th>
                <th className="px-5 py-3 font-medium">Lead time</th>
                <th className="px-5 py-3 font-medium">Pagamento</th>
                <th className="px-5 py-3 font-medium">Status</th>
                {canEdit && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {suppliersQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!suppliersQuery.isLoading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum fornecedor cadastrado ainda.
                  </td>
                </tr>
              )}
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{s.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{s.contact ?? '—'}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{s.leadTimeDays !== null ? `${s.leadTimeDays} dia(s)` : '—'}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{s.paymentTerms ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge variant={s.isActive ? 'success' : 'secondary'}>{s.isActive ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      {deactivatingId === s.id ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-margin-danger text-white hover:bg-margin-danger/90"
                            disabled={removeMutation.isPending}
                            onClick={() => removeMutation.mutate(s.id)}
                          >
                            {removeMutation.isPending ? 'Desativando…' : 'Confirmar'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeactivatingId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setFormMode({ edit: s })}>
                            Editar
                          </Button>
                          {s.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="hover:border-margin-danger hover:text-margin-danger"
                              onClick={() => setDeactivatingId(s.id)}
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
