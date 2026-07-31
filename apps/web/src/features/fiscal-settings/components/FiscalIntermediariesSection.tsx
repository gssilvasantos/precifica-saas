import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFiscalIntermediaries,
  removeFiscalIntermediary,
  upsertFiscalIntermediary,
  type UpsertFiscalMarketplaceIntermediaryInput,
} from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { extractErrorMessage } from '../../../lib/extract-error-message';

interface Props {
  canEdit: boolean;
}

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyForm(): UpsertFiscalMarketplaceIntermediaryInput {
  return { channelCode: '', cnpj: '', idCadIntTran: '' };
}

// Grupo G da NF-e (NT 2020.006) — dados do intermediador (marketplace) na
// nota fiscal. cnpj é da PLATAFORMA (Mercado Livre, Shopee...), idCadIntTran
// é o identificador do PRÓPRIO vendedor cadastrado naquela plataforma. Um
// registro por canal (channelCode é a chave de upsert).
export default function FiscalIntermediariesSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UpsertFiscalMarketplaceIntermediaryInput>(emptyForm());
  const [removingChannel, setRemovingChannel] = useState<string | null>(null);

  const intermediariesQuery = useQuery({ queryKey: ['fiscal-intermediaries'], queryFn: fetchFiscalIntermediaries });
  const intermediaries = intermediariesQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fiscal-intermediaries'] });

  const upsertMutation = useMutation({
    mutationFn: (input: UpsertFiscalMarketplaceIntermediaryInput) => upsertFiscalIntermediary(input),
    onSuccess: () => {
      invalidate();
      setForm(emptyForm());
      setShowForm(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (channelCode: string) => removeFiscalIntermediary(channelCode),
    onSuccess: () => {
      invalidate();
      setRemovingChannel(null);
    },
  });

  const canSubmit = form.channelCode.trim() !== '' && form.cnpj.trim() !== '' && form.idCadIntTran.trim() !== '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Intermediador de marketplace na NF-e</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            CNPJ da plataforma e ID de cadastro do vendedor — obrigatório para NF-e de vendas via marketplace (NT 2020.006).
          </p>
        </div>
        {canEdit && !showForm && (
          <Button
            onClick={() => {
              setForm(emptyForm());
              setShowForm(true);
            }}
          >
            Novo intermediador
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="p-5">
          <h3 className="font-serif text-base font-semibold text-foreground">Intermediador (canal)</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-foreground">
              Código do canal
              <input
                value={form.channelCode}
                onChange={(e) => setForm((f) => ({ ...f, channelCode: e.target.value }))}
                placeholder="MERCADO_LIVRE"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              CNPJ da plataforma
              <input value={form.cnpj} onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              ID de cadastro do vendedor
              <input
                value={form.idCadIntTran}
                onChange={(e) => setForm((f) => ({ ...f, idCadIntTran: e.target.value }))}
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button
              disabled={!canSubmit || upsertMutation.isPending}
              onClick={() =>
                upsertMutation.mutate({
                  channelCode: form.channelCode.trim(),
                  cnpj: form.cnpj.trim(),
                  idCadIntTran: form.idCadIntTran.trim(),
                })
              }
            >
              {upsertMutation.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            {upsertMutation.isError && (
              <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(upsertMutation.error)}</span>
            )}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Canal</th>
                <th className="px-5 py-3 font-medium">CNPJ da plataforma</th>
                <th className="px-5 py-3 font-medium">ID de cadastro</th>
                {canEdit && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {intermediariesQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!intermediariesQuery.isLoading && intermediaries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum intermediador cadastrado ainda.
                  </td>
                </tr>
              )}
              {intermediaries.map((i) => (
                <tr key={i.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{i.channelCode}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{i.cnpj}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{i.idCadIntTran}</td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      {removingChannel === i.channelCode ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="bg-margin-danger text-white hover:bg-margin-danger/90"
                            disabled={removeMutation.isPending}
                            onClick={() => removeMutation.mutate(i.channelCode)}
                          >
                            {removeMutation.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setRemovingChannel(null)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setForm({ channelCode: i.channelCode, cnpj: i.cnpj, idCadIntTran: i.idCadIntTran });
                              setShowForm(true);
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="hover:border-margin-danger hover:text-margin-danger"
                            onClick={() => setRemovingChannel(i.channelCode)}
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
