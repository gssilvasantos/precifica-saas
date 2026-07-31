import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  addOrderToBatch,
  cancelDispatchBatch,
  concludeDispatchBatch,
  createDispatchBatch,
  fetchCarrierMatch,
  fetchDispatchBatch,
  fetchDispatchBatches,
  generateDispatchLabel,
  removeOrderFromBatch,
  type DispatchBatch,
  type DispatchBatchOrder,
  type DispatchBatchStatus,
  type RecipientAddressInput,
} from '../features/dispatch-batches/api';
import { fetchCarrierServices, fetchCarriers } from '../features/freight-shipping/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function BatchStatusBadge({ status }: { status: DispatchBatchStatus }) {
  if (status === 'DESPACHADO') return <Badge variant="success">Despachado</Badge>;
  if (status === 'CANCELADO') return <Badge variant="secondary">Cancelado</Badge>;
  if (status === 'ETIQUETADO') return <Badge variant="warning">Etiquetado</Badge>;
  return <Badge variant="accent">Aberto</Badge>;
}

function OrderStatusBadge({ status }: { status: DispatchBatchOrder['status'] }) {
  if (status === 'ETIQUETADO') return <Badge variant="success">Etiquetado</Badge>;
  if (status === 'ERRO') return <Badge variant="danger">Erro</Badge>;
  return <Badge variant="secondary">Pendente</Badge>;
}

function CreateDispatchBatchForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'MANUAL' | 'CARRIER'>('CARRIER');
  const [formaEnvio, setFormaEnvio] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [carrierServiceId, setCarrierServiceId] = useState('');
  const [notes, setNotes] = useState('');

  const carriersQuery = useQuery({ queryKey: ['carriers'], queryFn: fetchCarriers });
  const carriers = carriersQuery.data ?? [];
  const servicesQuery = useQuery({
    queryKey: ['carrier-services', carrierId],
    queryFn: () => fetchCarrierServices(carrierId),
    enabled: carrierId !== '',
  });
  const services = servicesQuery.data ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      createDispatchBatch({
        formaEnvio: mode === 'MANUAL' ? formaEnvio.trim() : undefined,
        carrierServiceId: mode === 'CARRIER' ? carrierServiceId : undefined,
        notes: notes.trim() === '' ? undefined : notes.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dispatch-batches'] });
      onDone();
    },
  });

  const canSubmit = mode === 'MANUAL' ? formaEnvio.trim() !== '' : carrierServiceId !== '';

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Novo lote de expedição</h3>
      <div className="mt-3 flex gap-2 text-xs">
        <Button variant={mode === 'CARRIER' ? 'default' : 'outline'} size="sm" onClick={() => setMode('CARRIER')}>
          Por transportador/serviço
        </Button>
        <Button variant={mode === 'MANUAL' ? 'default' : 'outline'} size="sm" onClick={() => setMode('MANUAL')}>
          Forma de envio manual
        </Button>
      </div>

      {mode === 'CARRIER' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-foreground">
            Transportadora
            <select
              value={carrierId}
              onChange={(e) => {
                setCarrierId(e.target.value);
                setCarrierServiceId('');
              }}
              className={inputClass}
            >
              <option value="">Selecione…</option>
              {carriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-foreground">
            Serviço
            <select value={carrierServiceId} onChange={(e) => setCarrierServiceId(e.target.value)} className={inputClass} disabled={carrierId === ''}>
              <option value="">Selecione…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label className="mt-3 block text-xs font-medium text-foreground">
          Forma de envio (ex.: CORREIOS, MERCADO_ENVIOS, TRANSPORTADORA)
          <input value={formaEnvio} onChange={(e) => setFormaEnvio(e.target.value.toUpperCase())} className={inputClass} />
        </label>
      )}

      <label className="mt-3 block text-xs font-medium text-foreground">
        Observações (opcional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>

      <div className="mt-4 flex items-center gap-2">
        <Button disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Criar lote'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function GenerateLabelForm({ batchId, batchOrderId, onDone }: { batchId: string; batchOrderId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [packageWeightKg, setPackageWeightKg] = useState('');
  const [declaredValue, setDeclaredValue] = useState('');
  const [avisoRecebimento, setAvisoRecebimento] = useState(false);
  const [maoPropria, setMaoPropria] = useState(false);
  const [address, setAddress] = useState<RecipientAddressInput>({
    name: '',
    document: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: '',
    postalCode: '',
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      const hasManualAddress = address.name.trim() !== '' && address.street.trim() !== '';
      return generateDispatchLabel(batchId, batchOrderId, {
        packageWeightKg: packageWeightKg === '' ? undefined : Number(packageWeightKg),
        declaredValue: declaredValue === '' ? undefined : Number(declaredValue),
        recipientAddress: hasManualAddress ? address : undefined,
        avisoRecebimento,
        maoPropria,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dispatch-batch', batchId] });
      onDone();
    },
  });

  const setField = (field: keyof RecipientAddressInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="mt-2 rounded-md border border-border bg-secondary/30 p-3">
      <p className="text-xs text-muted-foreground">
        Preencha o endereço do destinatário e o peso apenas se a forma de envio exigir etiqueta via transportadora avulsa. Para etiqueta nativa do
        marketplace, deixe em branco e gere direto.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Peso do pacote (kg)
          <input type="number" step="0.01" value={packageWeightKg} onChange={(e) => setPackageWeightKg(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Valor declarado (opcional)
          <input type="number" step="0.01" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Destinatário — nome
          <input value={address.name} onChange={setField('name')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          CPF/CNPJ (opcional)
          <input value={address.document} onChange={setField('document')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Rua
          <input value={address.street} onChange={setField('street')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Número
          <input value={address.number} onChange={setField('number')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Complemento (opcional)
          <input value={address.complement} onChange={setField('complement')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Bairro
          <input value={address.neighborhood} onChange={setField('neighborhood')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Cidade
          <input value={address.city} onChange={setField('city')} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          UF
          <input value={address.state} onChange={setField('state')} className={inputClass} maxLength={2} />
        </label>
        <label className="text-xs font-medium text-foreground">
          CEP
          <input value={address.postalCode} onChange={setField('postalCode')} className={inputClass} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-foreground">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={avisoRecebimento} onChange={(e) => setAvisoRecebimento(e.target.checked)} />
          Aviso de recebimento
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={maoPropria} onChange={(e) => setMaoPropria(e.target.checked)} />
          Mão própria
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={generateMutation.isPending} onClick={() => generateMutation.mutate()}>
          {generateMutation.isPending ? 'Gerando…' : 'Gerar etiqueta'}
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        {generateMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(generateMutation.error)}</span>}
      </div>
    </div>
  );
}

function BatchDetail({ batch, canEdit }: { batch: DispatchBatch; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState('');
  const [labelFormFor, setLabelFormFor] = useState<string | null>(null);
  const [showMatch, setShowMatch] = useState(false);

  const detailQuery = useQuery({ queryKey: ['dispatch-batch', batch.id], queryFn: () => fetchDispatchBatch(batch.id) });
  const orders = detailQuery.data?.orders ?? [];

  const matchQuery = useQuery({ queryKey: ['dispatch-batch-match', batch.id], queryFn: () => fetchCarrierMatch(batch.id), enabled: showMatch });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['dispatch-batch', batch.id] });
    void queryClient.invalidateQueries({ queryKey: ['dispatch-batches'] });
  };

  const addOrderMutation = useMutation({
    mutationFn: () => addOrderToBatch(batch.id, orderId.trim()),
    onSuccess: () => {
      invalidate();
      setOrderId('');
    },
  });
  const removeOrderMutation = useMutation({ mutationFn: (batchOrderId: string) => removeOrderFromBatch(batch.id, batchOrderId), onSuccess: invalidate });

  const canAddRemove = canEdit && batch.status === 'ABERTO';

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <Button variant="outline" size="sm" onClick={() => setShowMatch((v) => !v)}>
          {showMatch ? 'Ocultar transportador sugerido' : 'Ver transportador sugerido'}
        </Button>
        {showMatch && (
          <p className="mt-2 text-xs text-muted-foreground">
            {matchQuery.isLoading && 'Consultando…'}
            {!matchQuery.isLoading && !matchQuery.data && 'Nenhum transportador/serviço cadastrado bate com esta forma de envio.'}
            {matchQuery.data && (
              <>
                {matchQuery.data.carrierName} — {matchQuery.data.serviceName}
                {matchQuery.data.estimativaEntregaDias ? ` (${matchQuery.data.estimativaEntregaDias}d)` : ''}
              </>
            )}
          </p>
        )}
      </div>

      {canAddRemove && (
        <div className="flex items-end gap-2">
          <label className="flex-1 text-xs font-medium text-foreground">
            ID do pedido (Kyneti)
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} className={inputClass} />
          </label>
          <Button size="sm" disabled={orderId.trim() === '' || addOrderMutation.isPending} onClick={() => addOrderMutation.mutate()}>
            Adicionar pedido
          </Button>
        </div>
      )}
      {addOrderMutation.isError && <p className="text-xs font-medium text-margin-danger">{extractErrorMessage(addOrderMutation.error)}</p>}

      {detailQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando pedidos…</p>}
      {!detailQuery.isLoading && orders.length === 0 && <p className="text-xs text-muted-foreground">Nenhum pedido neste lote ainda.</p>}
      {orders.map((o) => (
        <Card key={o.id} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-sans text-xs font-medium text-foreground">{o.orderId}</span>
                <OrderStatusBadge status={o.status} />
              </div>
              {o.trackingCode && <p className="mt-1 text-xs text-muted-foreground">Rastreio: {o.trackingCode}</p>}
              {o.labelUrl && (
                <a href={o.labelUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-primary underline">
                  Ver etiqueta
                </a>
              )}
              {o.errorMessage && <p className="mt-1 text-xs font-medium text-margin-danger">{o.errorMessage}</p>}
            </div>
            {canEdit && batch.status !== 'DESPACHADO' && batch.status !== 'CANCELADO' && (
              <div className="flex gap-2">
                {o.status !== 'ETIQUETADO' && (
                  <Button variant="outline" size="sm" onClick={() => setLabelFormFor(labelFormFor === o.id ? null : o.id)}>
                    Gerar etiqueta
                  </Button>
                )}
                {canAddRemove && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="hover:border-margin-danger hover:text-margin-danger"
                    disabled={removeOrderMutation.isPending}
                    onClick={() => removeOrderMutation.mutate(o.id)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            )}
          </div>
          {labelFormFor === o.id && <GenerateLabelForm batchId={batch.id} batchOrderId={o.id} onDone={() => setLabelFormFor(null)} />}
        </Card>
      ))}
    </div>
  );
}

function DispatchBatchRow({ batch, canEdit }: { batch: DispatchBatch; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['dispatch-batches'] });
  const concludeMutation = useMutation({ mutationFn: () => concludeDispatchBatch(batch.id), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: () => cancelDispatchBatch(batch.id), onSuccess: invalidate });

  const canConclude = batch.status === 'ABERTO' || batch.status === 'ETIQUETADO';
  const canCancel = batch.status === 'ABERTO' || batch.status === 'ETIQUETADO';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base font-semibold text-foreground">{batch.formaEnvio}</h3>
            <BatchStatusBadge status={batch.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Criado em {dateFormatter.format(new Date(batch.createdAt))}
            {batch.concludedAt && ` · Concluído em ${dateFormatter.format(new Date(batch.concludedAt))}`}
            {batch.notes && ` · ${batch.notes}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar pedidos' : 'Ver pedidos'}
          </Button>
          {canEdit && canConclude && (
            <Button size="sm" disabled={concludeMutation.isPending} onClick={() => concludeMutation.mutate()}>
              {concludeMutation.isPending ? 'Concluindo…' : 'Concluir/Despachar'}
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
      {(concludeMutation.isError || cancelMutation.isError) && (
        <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(concludeMutation.error ?? cancelMutation.error)}</p>
      )}
      {expanded && <BatchDetail batch={batch} canEdit={canEdit} />}
    </Card>
  );
}

export default function DispatchBatchesPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [showForm, setShowForm] = useState(false);
  const batchesQuery = useQuery({ queryKey: ['dispatch-batches'], queryFn: fetchDispatchBatches });
  const batches = batchesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Expedição em Lote</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Agrupe pedidos já conferidos no Pick &amp; Pack por forma de envio, gere etiquetas e conclua o despacho.
          </p>
        </div>
        {canEdit && !showForm && <Button onClick={() => setShowForm(true)}>Novo lote</Button>}
      </div>

      {showForm && <CreateDispatchBatchForm onDone={() => setShowForm(false)} />}

      <div className="space-y-3">
        {batchesQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!batchesQuery.isLoading && batches.length === 0 && <p className="text-sm text-muted-foreground">Nenhum lote de expedição ainda.</p>}
        {batches.map((batch) => (
          <DispatchBatchRow key={batch.id} batch={batch} canEdit={canEdit} />
        ))}
      </div>
    </div>
  );
}
