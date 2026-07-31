import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import {
  createCarrier,
  createCarrierService,
  fetchCarrierServices,
  fetchCarriers,
  fetchFreightConnections,
  removeFreightConnection,
  setCarrierActive,
  setCarrierServiceActive,
  updateCarrier,
  updateCarrierService,
  upsertFreightConnection,
  type Carrier,
  type CarrierServiceInput,
} from '../features/freight-shipping/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? <Badge variant="success">Ativa</Badge> : <Badge variant="secondary">Inativa</Badge>;
}

function CarrierServiceForm({ carrierId, onDone }: { carrierId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [estimativaEntregaDias, setEstimativaEntregaDias] = useState('');
  const [automationCode, setAutomationCode] = useState('');

  const createMutation = useMutation({
    mutationFn: (input: CarrierServiceInput) => createCarrierService(carrierId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['carrier-services', carrierId] });
      onDone();
    },
  });

  return (
    <Card className="p-4">
      <h4 className="text-sm font-semibold text-foreground">Novo serviço</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Nome do serviço
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Apelidos (separados por vírgula)
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Estimativa de entrega (dias)
          <input type="number" min={1} value={estimativaEntregaDias} onChange={(e) => setEstimativaEntregaDias(e.target.value)} className={inputClass} />
        </label>
        <label className="text-xs font-medium text-foreground">
          Código de automação (opcional)
          <input value={automationCode} onChange={(e) => setAutomationCode(e.target.value)} className={inputClass} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          disabled={name.trim() === '' || createMutation.isPending}
          onClick={() =>
            createMutation.mutate({
              name: name.trim(),
              aliases: aliases.trim() === '' ? undefined : aliases.split(',').map((a) => a.trim()).filter(Boolean),
              estimativaEntregaDias: estimativaEntregaDias === '' ? undefined : Number(estimativaEntregaDias),
              automationCode: automationCode.trim() === '' ? undefined : automationCode.trim(),
            })
          }
        >
          {createMutation.isPending ? 'Criando…' : 'Criar serviço'}
        </Button>
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        {createMutation.isError && <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</span>}
      </div>
    </Card>
  );
}

function CarrierServicesSection({ carrierId, canEdit }: { carrierId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const servicesQuery = useQuery({ queryKey: ['carrier-services', carrierId], queryFn: () => fetchCarrierServices(carrierId) });
  const services = servicesQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['carrier-services', carrierId] });
  const toggleActiveMutation = useMutation({
    mutationFn: ({ serviceId, isActive }: { serviceId: string; isActive: boolean }) => setCarrierServiceActive(carrierId, serviceId, isActive),
    onSuccess: invalidate,
  });

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {servicesQuery.isLoading && <p className="text-xs text-muted-foreground">Carregando serviços…</p>}
      {!servicesQuery.isLoading && services.length === 0 && !showForm && <p className="text-xs text-muted-foreground">Nenhum serviço cadastrado.</p>}
      {services.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Serviço</th>
              <th className="py-1.5 pr-3 font-medium">Apelidos</th>
              <th className="py-1.5 pr-3 font-medium">Prazo</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              {canEdit && <th className="py-1.5 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{s.name}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{s.aliases.join(', ') || '—'}</td>
                <td className="py-1.5 pr-3 font-sans text-foreground">{s.estimativaEntregaDias ? `${s.estimativaEntregaDias}d` : '—'}</td>
                <td className="py-1.5 pr-3">
                  <ActiveBadge isActive={s.isActive} />
                </td>
                {canEdit && (
                  <td className="py-1.5 pr-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggleActiveMutation.isPending}
                      onClick={() => toggleActiveMutation.mutate({ serviceId: s.id, isActive: !s.isActive })}
                    >
                      {s.isActive ? 'Desativar' : 'Ativar'}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && !showForm && (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          Adicionar serviço
        </Button>
      )}
      {canEdit && showForm && <CarrierServiceForm carrierId={carrierId} onDone={() => setShowForm(false)} />}
    </div>
  );
}

function CarrierRow({ carrier, canEdit }: { carrier: Carrier; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(carrier.name);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['carriers'] });
  const updateMutation = useMutation({
    mutationFn: () => updateCarrier(carrier.id, name.trim()),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const toggleActiveMutation = useMutation({ mutationFn: () => setCarrierActive(carrier.id, !carrier.isActive), onSuccess: invalidate });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              <Button size="sm" disabled={name.trim() === '' || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
                Salvar
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setName(carrier.name); }}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <h3 className="font-serif text-base font-semibold text-foreground">{carrier.name}</h3>
              <ActiveBadge isActive={carrier.isActive} />
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ocultar serviços' : 'Ver serviços'}
          </Button>
          {canEdit && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="hover:border-margin-danger hover:text-margin-danger"
              disabled={toggleActiveMutation.isPending}
              onClick={() => toggleActiveMutation.mutate()}
            >
              {carrier.isActive ? 'Desativar' : 'Ativar'}
            </Button>
          )}
        </div>
      </div>
      {updateMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(updateMutation.error)}</p>}
      {expanded && <CarrierServicesSection carrierId={carrier.id} canEdit={canEdit} />}
    </Card>
  );
}

function CreateCarrierForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const createMutation = useMutation({
    mutationFn: () => createCarrier(name.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['carriers'] });
      onDone();
    },
  });

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Nova transportadora</h3>
      <div className="mt-3 flex items-end gap-2">
        <label className="flex-1 text-xs font-medium text-foreground">
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>
        <Button disabled={name.trim() === '' || createMutation.isPending} onClick={() => createMutation.mutate()}>
          {createMutation.isPending ? 'Criando…' : 'Criar'}
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancelar
        </Button>
      </div>
      {createMutation.isError && <p className="mt-2 text-xs font-medium text-margin-danger">{extractErrorMessage(createMutation.error)}</p>}
    </Card>
  );
}

function FreightConnectionsSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [providerCode, setProviderCode] = useState('');
  const [credentialJson, setCredentialJson] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const connectionsQuery = useQuery({ queryKey: ['freight-connections'], queryFn: fetchFreightConnections });
  const connections = connectionsQuery.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['freight-connections'] });
  const upsertMutation = useMutation({
    mutationFn: () => upsertFreightConnection(providerCode.trim(), JSON.parse(credentialJson) as Record<string, unknown>),
    onSuccess: () => {
      invalidate();
      setProviderCode('');
      setCredentialJson('{}');
    },
  });
  const removeMutation = useMutation({ mutationFn: (code: string) => removeFreightConnection(code), onSuccess: invalidate });

  const handleSubmit = () => {
    try {
      JSON.parse(credentialJson);
      setJsonError(null);
      upsertMutation.mutate();
    } catch {
      setJsonError('Credencial precisa ser um JSON válido.');
    }
  };

  return (
    <Card className="p-5">
      <h3 className="font-serif text-base font-semibold text-foreground">Conexões com transportadoras</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Credenciais (token, chave, usuário/senha) ficam criptografadas — nunca são exibidas de volta após salvas.
      </p>

      {connectionsQuery.isLoading && <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>}
      {!connectionsQuery.isLoading && connections.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Nenhuma conexão configurada.</p>}
      {connections.length > 0 && (
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Provedor</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              {canEdit && <th className="py-1.5 pr-3 font-medium">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id} className="border-t border-border/60">
                <td className="py-1.5 pr-3 font-sans text-foreground">{c.providerCode}</td>
                <td className="py-1.5 pr-3">
                  <ActiveBadge isActive={c.isActive} />
                </td>
                {canEdit && (
                  <td className="py-1.5 pr-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover:border-margin-danger hover:text-margin-danger"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(c.providerCode)}
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

      {canEdit && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-foreground">
              Código do provedor (ex.: melhor-envio, frenet, correios)
              <input value={providerCode} onChange={(e) => setProviderCode(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Credencial (JSON)
              <textarea value={credentialJson} onChange={(e) => setCredentialJson(e.target.value)} rows={3} className={inputClass} />
            </label>
          </div>
          <Button size="sm" disabled={providerCode.trim() === '' || upsertMutation.isPending} onClick={handleSubmit}>
            {upsertMutation.isPending ? 'Salvando…' : 'Salvar conexão'}
          </Button>
          {jsonError && <p className="text-xs font-medium text-margin-danger">{jsonError}</p>}
          {upsertMutation.isError && <p className="text-xs font-medium text-margin-danger">{extractErrorMessage(upsertMutation.error)}</p>}
        </div>
      )}
    </Card>
  );
}

export default function CarriersPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  const [showForm, setShowForm] = useState(false);
  const carriersQuery = useQuery({ queryKey: ['carriers'], queryFn: fetchCarriers });
  const carriers = carriersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-foreground">Transportadoras e Serviços</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cadastro de transportadoras, seus serviços de frete (usados no matching automático por forma de envio) e conexões com provedores externos.
          </p>
        </div>
        {canEdit && !showForm && <Button onClick={() => setShowForm(true)}>Nova transportadora</Button>}
      </div>

      {showForm && <CreateCarrierForm onDone={() => setShowForm(false)} />}

      <div className="space-y-3">
        {carriersQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!carriersQuery.isLoading && carriers.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma transportadora cadastrada.</p>}
        {carriers.map((carrier) => (
          <CarrierRow key={carrier.id} carrier={carrier} canEdit={canEdit} />
        ))}
      </div>

      <FreightConnectionsSection canEdit={canEdit} />
    </div>
  );
}
