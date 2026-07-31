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
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

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
          <h2 className="font-serif text-xl font-semibold text-foreground">Perfis fiscais</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Regime tributário e alíquota estimada, vinculável a produtos individualmente.
          </p>
        </div>
        {canEdit && formMode === 'closed' && (
          <Button onClick={() => setFormMode('create')}>
            Novo perfil
          </Button>
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

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando perfis…
                  </td>
                </tr>
              )}

              {!profilesQuery.isLoading && profiles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum perfil fiscal cadastrado ainda.
                  </td>
                </tr>
              )}

              {profiles.map((profile) => (
                <tr key={profile.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{profile.name}</td>
                  <td className="px-5 py-3 text-foreground">{TAX_REGIME_LABEL[profile.regime]}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{profile.estimatedRatePct.toFixed(2)}%</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{profile.notes ?? '—'}</td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      {deletingId === profile.id ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-margin-danger text-white hover:bg-margin-danger/90"
                            onClick={() => deleteMutation.mutate(profile.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setFormMode({ edit: profile })}>
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="hover:border-margin-danger hover:text-margin-danger"
                            onClick={() => setDeletingId(profile.id)}
                          >
                            Excluir
                          </Button>
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
