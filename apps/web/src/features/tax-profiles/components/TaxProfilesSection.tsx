import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TAX_REGIME_LABEL,
  createTaxProfile,
  deleteTaxProfile,
  fetchTaxProfiles,
  updateTaxProfile,
  type TaxProfile,
  type TaxProfileInput,
} from '../api';
import TaxProfileForm from './TaxProfileForm';

interface Props {
  canEdit: boolean;
}

// Perfis fiscais (TaxProfile) — regime + alíquota estimada, vinculável a
// produtos (Product.taxProfileId). CRUD completo já existia no backend;
// esta é a primeira tela que expõe create/edit/delete sem curl.
export default function TaxProfilesSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: TaxProfile }>('closed');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const profilesQuery = useQuery({ queryKey: ['tax-profiles'], queryFn: fetchTaxProfiles });
  const profiles = profilesQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tax-profiles'] });

  const createMutation = useMutation({
    mutationFn: (input: TaxProfileInput) => createTaxProfile(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaxProfileInput }) => updateTaxProfile(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTaxProfile(id),
    onSuccess: () => {
      invalidate();
      setDeletingId(null);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink-900">Perfis fiscais</h2>
          <p className="mt-1 text-sm text-ink-500">
            Regime tributário e alíquota estimada, vinculável a produtos individualmente.
          </p>
        </div>
        {canEdit && formMode === 'closed' && (
          <button
            type="button"
            onClick={() => setFormMode('create')}
            className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink-700"
          >
            Novo perfil
          </button>
        )}
      </div>

      {formMode === 'create' && (
        <TaxProfileForm
          onSubmit={(input) => createMutation.mutate(input)}
          onCancel={() => setFormMode('closed')}
          isSubmitting={createMutation.isPending}
        />
      )}

      {typeof formMode === 'object' && (
        <TaxProfileForm
          initial={formMode.edit}
          onSubmit={(input) => updateMutation.mutate({ id: formMode.edit.id, input })}
          onCancel={() => setFormMode('closed')}
          isSubmitting={updateMutation.isPending}
        />
      )}

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Nome</th>
              <th className="px-5 py-3 font-medium">Regime</th>
              <th className="px-5 py-3 font-medium">Alíquota estimada</th>
              <th className="px-5 py-3 font-medium">Notas</th>
              {canEdit && <th className="px-5 py-3 font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {profilesQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Carregando perfis…
                </td>
              </tr>
            )}

            {!profilesQuery.isLoading && profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Nenhum perfil fiscal cadastrado ainda.
                </td>
              </tr>
            )}

            {profiles.map((profile) => (
              <tr key={profile.id} className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                <td className="px-5 py-3 font-medium text-ink-900">{profile.name}</td>
                <td className="px-5 py-3 text-ink-700">{TAX_REGIME_LABEL[profile.regime]}</td>
                <td className="px-5 py-3 font-sans text-ink-700">{profile.estimatedRatePct.toFixed(2)}%</td>
                <td className="px-5 py-3 text-xs text-ink-500">{profile.notes ?? '—'}</td>
                {canEdit && (
                  <td className="px-5 py-3 text-right">
                    {deletingId === profile.id ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(profile.id)}
                          disabled={deleteMutation.isPending}
                          className="rounded-lg bg-margin-danger px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                        >
                          {deleteMutation.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-ink-500"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setFormMode({ edit: profile })}
                          className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-gold hover:text-gold"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(profile.id)}
                          className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-margin-danger hover:text-margin-danger"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
