import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  cancelInvoice,
  checkInvoiceStatus,
  emitInvoice,
  fetchAllInvoices,
  type EmitInvoiceInput,
  type FiscalAddress,
  type FiscalInvoice,
  type FiscalInvoiceStatus,
  type NfeFinalidade,
} from '../features/fiscal-invoices/api';
import { fetchNaturezasOperacao } from '../features/fiscal-settings/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

function StatusBadge({ status }: { status: FiscalInvoiceStatus }) {
  if (status === 'AUTORIZADA') return <Badge variant="success">Autorizada</Badge>;
  if (status === 'ERRO') return <Badge variant="danger">Erro</Badge>;
  if (status === 'CANCELADA') return <Badge variant="secondary">Cancelada</Badge>;
  if (status === 'PROCESSANDO') return <Badge variant="warning">Processando</Badge>;
  return <Badge variant="accent">Pendente</Badge>;
}

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyAddress(): FiscalAddress {
  return { logradouro: '', numero: '', bairro: '', municipio: '', uf: '', cep: '' };
}

// Emissão de NF-e (Fase 3, benchmark Tiny ERP) — a última tela do Tier 1 do
// gap de frontend. O pedido não guarda nome/endereço do comprador (só
// buyerTaxId), então o destinatário é digitado aqui na hora de emitir; o
// backend usa Order.buyerTaxId como fallback só se `documento` ficar em
// branco.
function EmitInvoiceForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const naturezasQuery = useQuery({ queryKey: ['naturezas-operacao'], queryFn: fetchNaturezasOperacao });
  const naturezas = (naturezasQuery.data ?? []).filter((n) => n.isActive);

  const [orderId, setOrderId] = useState('');
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [telefone, setTelefone] = useState('');
  const [endereco, setEndereco] = useState<FiscalAddress>(emptyAddress());
  const [finalidade, setFinalidade] = useState<NfeFinalidade>('NORMAL');
  const [naturezaOperacaoId, setNaturezaOperacaoId] = useState('');
  const [documentoReferenciado, setDocumentoReferenciado] = useState('');

  const emitMutation = useMutation({
    mutationFn: () => {
      const input: EmitInvoiceInput = {
        destinatario: {
          nome: nome.trim(),
          documento: documento.trim() === '' ? undefined : documento.trim(),
          endereco,
          telefone: telefone.trim() === '' ? undefined : telefone.trim(),
        },
        finalidade,
        naturezaOperacaoId: naturezaOperacaoId === '' ? undefined : naturezaOperacaoId,
        documentoReferenciado:
          finalidade === 'NORMAL'
            ? undefined
            : documentoReferenciado
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
      };
      return emitInvoice(orderId.trim(), input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fiscal-invoices'] });
      onDone();
    },
  });

  const canSubmit =
    orderId.trim() !== '' &&
    nome.trim() !== '' &&
    endereco.logradouro.trim() !== '' &&
    endereco.numero.trim() !== '' &&
    endereco.bairro.trim() !== '' &&
    endereco.municipio.trim() !== '' &&
    endereco.uf.trim() !== '' &&
    endereco.cep.trim() !== '' &&
    (finalidade === 'NORMAL' || documentoReferenciado.trim() !== '');

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Emitir NF-e</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Cole o ID do pedido (visível na tela de Pedidos) e preencha os dados do destinatário — o CPF/CNPJ é opcional
        se o pedido já tiver o documento do comprador sincronizado.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground sm:col-span-2">
          ID do pedido
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="uuid do pedido" className={inputClass} />
        </label>

        <label className="text-xs font-medium text-foreground">
          Nome do destinatário
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          CPF/CNPJ (opcional — usa o do pedido se em branco)
          <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={inputClass} />
        </label>

        <label className="text-xs font-medium text-foreground sm:col-span-2">
          Logradouro
          <input
            value={endereco.logradouro}
            onChange={(e) => setEndereco((a) => ({ ...a, logradouro: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Número
          <input value={endereco.numero} onChange={(e) => setEndereco((a) => ({ ...a, numero: e.target.value }))} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Bairro
          <input value={endereco.bairro} onChange={(e) => setEndereco((a) => ({ ...a, bairro: e.target.value }))} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Município
          <input
            value={endereco.municipio}
            onChange={(e) => setEndereco((a) => ({ ...a, municipio: e.target.value }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          UF
          <input
            maxLength={2}
            value={endereco.uf}
            onChange={(e) => setEndereco((a) => ({ ...a, uf: e.target.value.toUpperCase() }))}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          CEP
          <input value={endereco.cep} onChange={(e) => setEndereco((a) => ({ ...a, cep: e.target.value }))} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Telefone (opcional)
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputClass} />
        </label>

        <label className="text-xs font-medium text-foreground">
          Natureza de operação (opcional)
          <select value={naturezaOperacaoId} onChange={(e) => setNaturezaOperacaoId(e.target.value)} className={inputClass}>
            <option value="">Usar padrão do tenant</option>
            {naturezas.map((n) => (
              <option key={n.id} value={n.id}>
                {n.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          Finalidade
          <select value={finalidade} onChange={(e) => setFinalidade(e.target.value as NfeFinalidade)} className={inputClass}>
            <option value="NORMAL">Normal</option>
            <option value="COMPLEMENTAR">Complementar</option>
            <option value="AJUSTE">Ajuste</option>
            <option value="DEVOLUCAO">Devolução</option>
          </select>
        </label>

        {finalidade !== 'NORMAL' && (
          <label className="text-xs font-medium text-foreground sm:col-span-2">
            Chave(s) de acesso da NF-e de origem (44 dígitos, uma por linha)
            <textarea
              value={documentoReferenciado}
              onChange={(e) => setDocumentoReferenciado(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </label>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button disabled={!canSubmit || emitMutation.isPending} onClick={() => emitMutation.mutate()}>
          {emitMutation.isPending ? 'Emitindo…' : 'Emitir NF-e'}
        </Button>
        <Button variant="outline" className="hover:border-margin-danger hover:text-margin-danger" onClick={onDone}>
          Cancelar
        </Button>
        {emitMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(emitMutation.error)}</span>}
      </div>
    </Card>
  );
}

function InvoiceRow({ invoice, canEdit }: { invoice: FiscalInvoice; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [showCancel, setShowCancel] = useState(false);
  const [justificativa, setJustificativa] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['fiscal-invoices'] });

  const checkStatusMutation = useMutation({
    mutationFn: () => checkInvoiceStatus(invoice.id),
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelInvoice(invoice.id, justificativa.trim()),
    onSuccess: () => {
      invalidate();
      setShowCancel(false);
      setJustificativa('');
    },
  });

  const canCancel = invoice.status === 'AUTORIZADA';
  const canCheckStatus = invoice.status === 'PENDENTE' || invoice.status === 'PROCESSANDO';

  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40 align-top">
      <td className="px-5 py-3 font-sans text-xs text-foreground">{invoice.orderId}</td>
      <td className="px-5 py-3 text-foreground">{invoice.destNome}</td>
      <td className="px-5 py-3">
        <StatusBadge status={invoice.status} />
        {invoice.status === 'ERRO' && invoice.errorMessage && (
          <p className="mt-1 max-w-xs text-xs text-margin-danger">{invoice.errorMessage}</p>
        )}
      </td>
      <td className="px-5 py-3 font-sans text-foreground">{invoice.nfeNumber ?? '—'}</td>
      <td className="px-5 py-3 text-xs text-muted-foreground">{formatDate(invoice.requestedAt)}</td>
      <td className="px-5 py-3">
        {(invoice.xmlUrl || invoice.danfeUrl) && (
          <div className="flex flex-col gap-1 text-xs">
            {invoice.danfeUrl && (
              <a href={invoice.danfeUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                DANFE
              </a>
            )}
            {invoice.xmlUrl && (
              <a href={invoice.xmlUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                XML
              </a>
            )}
          </div>
        )}
      </td>
      {canEdit && (
        <td className="px-5 py-3 text-right">
          {showCancel ? (
            <div className="flex flex-col items-end gap-2">
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Justificativa (15–255 caracteres)"
                rows={2}
                className="w-56 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-margin-danger text-white hover:bg-margin-danger/90"
                  disabled={justificativa.trim().length < 15 || justificativa.trim().length > 255 || cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  {cancelMutation.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowCancel(false)}>
                  Voltar
                </Button>
              </div>
              {cancelMutation.isError && (
                <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(cancelMutation.error)}</span>
              )}
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              {canCheckStatus && (
                <Button variant="outline" size="sm" disabled={checkStatusMutation.isPending} onClick={() => checkStatusMutation.mutate()}>
                  {checkStatusMutation.isPending ? 'Consultando…' : 'Verificar status'}
                </Button>
              )}
              {canCancel && (
                <Button
                  variant="outline"
                  size="sm"
                  className="hover:border-margin-danger hover:text-margin-danger"
                  onClick={() => setShowCancel(true)}
                >
                  Cancelar NF-e
                </Button>
              )}
            </div>
          )}
        </td>
      )}
    </tr>
  );
}

export default function FiscalInvoicesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [statusFilter, setStatusFilter] = useState<FiscalInvoiceStatus | ''>('');
  const [showEmitForm, setShowEmitForm] = useState(false);

  const invoicesQuery = useQuery({
    queryKey: ['fiscal-invoices', statusFilter],
    queryFn: () => fetchAllInvoices(statusFilter === '' ? undefined : statusFilter),
  });
  const invoices = invoicesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Notas Fiscais (NF-e)</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Emissão via Focus NFe, consulta de status e cancelamento. Configure os dados do emitente em Configurações
            Fiscais antes de emitir.
          </p>
          {!canEdit && (
            <p className="mt-2 text-xs text-muted-foreground">
              Você tem acesso somente leitura — emitir e cancelar NF-e é restrito a Administrador/Editor de Preços.
            </p>
          )}
        </div>
        {canEdit && !showEmitForm && <Button onClick={() => setShowEmitForm(true)}>Emitir NF-e</Button>}
      </div>

      {showEmitForm && <EmitInvoiceForm onDone={() => setShowEmitForm(false)} />}

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-foreground">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FiscalInvoiceStatus | '')}
            className="ml-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todos</option>
            <option value="PENDENTE">Pendente</option>
            <option value="PROCESSANDO">Processando</option>
            <option value="AUTORIZADA">Autorizada</option>
            <option value="ERRO">Erro</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
        </label>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Pedido</th>
                <th className="px-5 py-3 font-medium">Destinatário</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Número NF-e</th>
                <th className="px-5 py-3 font-medium">Solicitada em</th>
                <th className="px-5 py-3 font-medium">Documentos</th>
                {canEdit && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {invoicesQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!invoicesQuery.isLoading && invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhuma NF-e emitida ainda.
                  </td>
                </tr>
              )}
              {invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} invoice={invoice} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
