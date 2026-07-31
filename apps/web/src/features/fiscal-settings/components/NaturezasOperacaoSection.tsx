import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNaturezaOperacao,
  fetchNaturezasOperacao,
  setNaturezaOperacaoActive,
  updateNaturezaOperacao,
  type CreateNaturezaOperacaoInput,
  type NaturezaOperacao,
} from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { extractErrorMessage } from '../../../lib/extract-error-message';

interface Props {
  canEdit: boolean;
}

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyForm(): CreateNaturezaOperacaoInput {
  return { nome: '', cfopVendaInterno: '', cfopVendaInterestadual: '', cfopDevolucaoInterno: '', cfopDevolucaoInterestadual: '' };
}

// Naturezas de Operação (Projeto Estruturante 4, benchmark Bling ERP) —
// resolve o CFOP usado na emissão de NF-e por natureza + UF de destino.
// cfopDevolucaoInterno/Interestadual são opcionais (só usados quando a
// finalidade da nota é DEVOLUCAO).
export default function NaturezasOperacaoSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<'closed' | 'create' | { edit: NaturezaOperacao }>('closed');
  const [form, setForm] = useState<CreateNaturezaOperacaoInput>(emptyForm());

  const naturezasQuery = useQuery({ queryKey: ['naturezas-operacao'], queryFn: fetchNaturezasOperacao });
  const naturezas = naturezasQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['naturezas-operacao'] });

  const createMutation = useMutation({
    mutationFn: (input: CreateNaturezaOperacaoInput) => createNaturezaOperacao(input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateNaturezaOperacaoInput }) => updateNaturezaOperacao(id, input),
    onSuccess: () => {
      invalidate();
      setFormMode('closed');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setNaturezaOperacaoActive(id, isActive),
    onSuccess: invalidate,
  });

  const openCreate = () => {
    setForm(emptyForm());
    setFormMode('create');
  };

  const openEdit = (n: NaturezaOperacao) => {
    setForm({
      nome: n.nome,
      cfopVendaInterno: n.cfopVendaInterno,
      cfopVendaInterestadual: n.cfopVendaInterestadual,
      cfopDevolucaoInterno: n.cfopDevolucaoInterno ?? '',
      cfopDevolucaoInterestadual: n.cfopDevolucaoInterestadual ?? '',
    });
    setFormMode({ edit: n });
  };

  const canSubmit = form.nome.trim() !== '' && form.cfopVendaInterno.trim() !== '' && form.cfopVendaInterestadual.trim() !== '';

  const submit = () => {
    const input: CreateNaturezaOperacaoInput = {
      nome: form.nome.trim(),
      cfopVendaInterno: form.cfopVendaInterno.trim(),
      cfopVendaInterestadual: form.cfopVendaInterestadual.trim(),
      cfopDevolucaoInterno: form.cfopDevolucaoInterno?.trim() || undefined,
      cfopDevolucaoInterestadual: form.cfopDevolucaoInterestadual?.trim() || undefined,
    };
    if (typeof formMode === 'object') {
      updateMutation.mutate({ id: formMode.edit.id, input });
    } else {
      createMutation.mutate(input);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const submitError = createMutation.error ?? updateMutation.error;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Naturezas de Operação (CFOP)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            CFOP de venda e devolução por natureza — usados na emissão de NF-e conforme UF de destino.
          </p>
        </div>
        {canEdit && formMode === 'closed' && <Button onClick={openCreate}>Nova natureza</Button>}
      </div>

      {formMode !== 'closed' && (
        <Card className="p-5">
          <h3 className="font-serif text-base font-semibold text-foreground">
            {typeof formMode === 'object' ? 'Editar natureza' : 'Nova natureza'}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-foreground sm:col-span-2">
              Nome
              <input
                value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex.: Venda de mercadoria — revenda"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              CFOP venda interno (mesma UF)
              <input
                value={form.cfopVendaInterno}
                onChange={(e) => setForm((f) => ({ ...f, cfopVendaInterno: e.target.value }))}
                placeholder="5102"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              CFOP venda interestadual
              <input
                value={form.cfopVendaInterestadual}
                onChange={(e) => setForm((f) => ({ ...f, cfopVendaInterestadual: e.target.value }))}
                placeholder="6102"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              CFOP devolução interno (opcional)
              <input
                value={form.cfopDevolucaoInterno}
                onChange={(e) => setForm((f) => ({ ...f, cfopDevolucaoInterno: e.target.value }))}
                placeholder="1202"
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              CFOP devolução interestadual (opcional)
              <input
                value={form.cfopDevolucaoInterestadual}
                onChange={(e) => setForm((f) => ({ ...f, cfopDevolucaoInterestadual: e.target.value }))}
                placeholder="2202"
                className={inputClass}
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button disabled={!canSubmit || isSubmitting} onClick={submit}>
              {isSubmitting ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={() => setFormMode('closed')}>
              Cancelar
            </Button>
            {submitError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(submitError)}</span>}
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">CFOP interno</th>
                <th className="px-5 py-3 font-medium">CFOP interestadual</th>
                <th className="px-5 py-3 font-medium">Status</th>
                {canEdit && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {naturezasQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!naturezasQuery.isLoading && naturezas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhuma natureza de operação cadastrada ainda.
                  </td>
                </tr>
              )}
              {naturezas.map((n) => (
                <tr key={n.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium text-foreground">{n.nome}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{n.cfopVendaInterno}</td>
                  <td className="px-5 py-3 font-sans text-foreground">{n.cfopVendaInterestadual}</td>
                  <td className="px-5 py-3">
                    <Badge variant={n.isActive ? 'success' : 'secondary'}>{n.isActive ? 'Ativa' : 'Inativa'}</Badge>
                  </td>
                  {canEdit && (
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(n)}>
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={toggleActiveMutation.isPending}
                          onClick={() => toggleActiveMutation.mutate({ id: n.id, isActive: !n.isActive })}
                        >
                          {n.isActive ? 'Desativar' : 'Ativar'}
                        </Button>
                      </div>
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
