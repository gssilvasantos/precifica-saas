import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REGIME_TRIBUTARIO_LABEL,
  fetchFiscalSettings,
  fetchNaturezasOperacao,
  upsertFiscalSettings,
  type FiscalEnvironment,
} from '../api';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { extractErrorMessage } from '../../../lib/extract-error-message';

interface Props {
  canEdit: boolean;
}

const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground';

// Configuração do emitente (Fase 3, benchmark Tiny ERP) — singleton por
// tenant. O token do Focus NFe nunca volta do backend (omitido em SafeFiscalSettings);
// o campo aqui é sempre um input de rotação: em branco = mantém o token já
// salvo, preenchido = grava um novo.
export default function FiscalSettingsForm({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['fiscal-settings'], queryFn: fetchFiscalSettings });
  const naturezasQuery = useQuery({ queryKey: ['naturezas-operacao'], queryFn: fetchNaturezasOperacao });
  const naturezas = naturezasQuery.data ?? [];

  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [regimeTributario, setRegimeTributario] = useState('1');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [bairro, setBairro] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [uf, setUf] = useState('');
  const [cep, setCep] = useState('');
  const [telefone, setTelefone] = useState('');
  const [focusNfeToken, setFocusNfeToken] = useState('');
  const [environment, setEnvironment] = useState<FiscalEnvironment>('HOMOLOGACAO');
  const [autoEmitOnApproval, setAutoEmitOnApproval] = useState(false);
  const [nfeSerie, setNfeSerie] = useState('');
  const [defaultNaturezaOperacaoId, setDefaultNaturezaOperacaoId] = useState('');

  const isConfigured = settingsQuery.data != null;

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setCnpj(s.cnpj);
    setRazaoSocial(s.razaoSocial);
    setNomeFantasia(s.nomeFantasia ?? '');
    setInscricaoEstadual(s.inscricaoEstadual);
    setRegimeTributario(String(s.regimeTributario));
    setLogradouro(s.logradouro);
    setNumero(s.numero);
    setBairro(s.bairro);
    setMunicipio(s.municipio);
    setUf(s.uf);
    setCep(s.cep);
    setTelefone(s.telefone ?? '');
    setEnvironment(s.environment);
    setAutoEmitOnApproval(s.autoEmitOnApproval);
    setNfeSerie(s.nfeSerie !== null ? String(s.nfeSerie) : '');
    setDefaultNaturezaOperacaoId(s.defaultNaturezaOperacaoId ?? '');
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertFiscalSettings({
        cnpj: cnpj.trim(),
        razaoSocial: razaoSocial.trim(),
        nomeFantasia: nomeFantasia.trim() === '' ? undefined : nomeFantasia.trim(),
        inscricaoEstadual: inscricaoEstadual.trim(),
        regimeTributario: Number(regimeTributario),
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        bairro: bairro.trim(),
        municipio: municipio.trim(),
        uf: uf.trim(),
        cep: cep.trim(),
        telefone: telefone.trim() === '' ? undefined : telefone.trim(),
        focusNfeToken: focusNfeToken.trim() === '' ? undefined : focusNfeToken.trim(),
        environment,
        autoEmitOnApproval,
        nfeSerie: nfeSerie.trim() === '' ? undefined : Number(nfeSerie),
        defaultNaturezaOperacaoId: defaultNaturezaOperacaoId === '' ? null : defaultNaturezaOperacaoId,
      }),
    onSuccess: () => {
      setFocusNfeToken('');
      void queryClient.invalidateQueries({ queryKey: ['fiscal-settings'] });
    },
  });

  const canSubmit =
    cnpj.trim() !== '' &&
    razaoSocial.trim() !== '' &&
    inscricaoEstadual.trim() !== '' &&
    logradouro.trim() !== '' &&
    numero.trim() !== '' &&
    bairro.trim() !== '' &&
    municipio.trim() !== '' &&
    uf.trim() !== '' &&
    cep.trim() !== '' &&
    (isConfigured || focusNfeToken.trim() !== '');

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Dados do emitente</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        CNPJ, endereço e credencial Focus NFe usados para emitir a NF-e. {!isConfigured && !settingsQuery.isLoading && (
          <span className="font-medium text-margin-warning">Ainda não configurado — nenhuma NF-e pode ser emitida.</span>
        )}
      </p>

      {settingsQuery.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-foreground">
              CNPJ
              <input disabled={!canEdit} value={cnpj} onChange={(e) => setCnpj(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground lg:col-span-2">
              Razão social
              <input disabled={!canEdit} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Nome fantasia (opcional)
              <input disabled={!canEdit} value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Inscrição estadual
              <input
                disabled={!canEdit}
                value={inscricaoEstadual}
                onChange={(e) => setInscricaoEstadual(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              Regime tributário
              <select disabled={!canEdit} value={regimeTributario} onChange={(e) => setRegimeTributario(e.target.value)} className={inputClass}>
                {Object.entries(REGIME_TRIBUTARIO_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-foreground lg:col-span-2">
              Logradouro
              <input disabled={!canEdit} value={logradouro} onChange={(e) => setLogradouro(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Número
              <input disabled={!canEdit} value={numero} onChange={(e) => setNumero(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Bairro
              <input disabled={!canEdit} value={bairro} onChange={(e) => setBairro(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Município
              <input disabled={!canEdit} value={municipio} onChange={(e) => setMunicipio(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              UF
              <input disabled={!canEdit} maxLength={2} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              CEP
              <input disabled={!canEdit} value={cep} onChange={(e) => setCep(e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs font-medium text-foreground">
              Telefone (opcional)
              <input disabled={!canEdit} value={telefone} onChange={(e) => setTelefone(e.target.value)} className={inputClass} />
            </label>

            <label className="text-xs font-medium text-foreground">
              Ambiente
              <select
                disabled={!canEdit}
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as FiscalEnvironment)}
                className={inputClass}
              >
                <option value="HOMOLOGACAO">Homologação</option>
                <option value="PRODUCAO">Produção</option>
              </select>
            </label>
            <label className="text-xs font-medium text-foreground">
              Série da NF-e (opcional)
              <input
                disabled={!canEdit}
                type="number"
                min={1}
                value={nfeSerie}
                onChange={(e) => setNfeSerie(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-medium text-foreground">
              Natureza de operação padrão (opcional)
              <select
                disabled={!canEdit}
                value={defaultNaturezaOperacaoId}
                onChange={(e) => setDefaultNaturezaOperacaoId(e.target.value)}
                className={inputClass}
              >
                <option value="">Nenhuma</option>
                {naturezas.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-foreground lg:col-span-2">
              Token Focus NFe {isConfigured && <span className="text-muted-foreground">(preencher só para rotacionar)</span>}
              <input
                disabled={!canEdit}
                type="password"
                value={focusNfeToken}
                onChange={(e) => setFocusNfeToken(e.target.value)}
                placeholder={isConfigured ? 'Mantém o token atual se em branco' : 'Obrigatório na primeira configuração'}
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2 self-end text-xs font-medium text-foreground">
              <input
                disabled={!canEdit}
                type="checkbox"
                checked={autoEmitOnApproval}
                onChange={(e) => setAutoEmitOnApproval(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Emitir NF-e automaticamente ao aprovar pedido
            </label>
          </div>

          {canEdit && (
            <div className="mt-4">
              <Button disabled={!canSubmit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? 'Salvando…' : 'Salvar dados do emitente'}
              </Button>
              {saveMutation.isSuccess && <span className="ml-3 text-xs font-medium text-margin-good">Salvo.</span>}
              {saveMutation.isError && (
                <span className="ml-3 text-xs font-medium text-margin-danger">{extractErrorMessage(saveMutation.error)}</span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
