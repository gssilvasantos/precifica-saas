import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  definirRegime,
  fetchRegimeVigente,
  fetchSugestaoDeAliquota,
  problemasPorCampo,
  type SimplesAnexo,
  type TaxRegime,
} from '../api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

interface Props {
  canEdit: boolean;
}

const REGIMES: { valor: TaxRegime; rotulo: string; ajuda: string }[] = [
  { valor: 'MEI_SIMEI', rotulo: 'MEI (SIMEI)', ajuda: 'DAS de valor fixo mensal — o imposto não é percentual.' },
  {
    valor: 'SIMPLES_NACIONAL',
    rotulo: 'Simples Nacional',
    ajuda: 'A alíquota é calculada sobre o faturamento dos 12 meses anteriores (RBT12) e muda de faixa sozinha.',
  },
  { valor: 'LUCRO_PRESUMIDO', rotulo: 'Lucro Presumido', ajuda: 'Exige ICMS da UF e os percentuais de presunção.' },
  { valor: 'LUCRO_REAL', rotulo: 'Lucro Real', ajuda: 'Exige a alíquota interna de ICMS da UF.' },
];

const ANEXOS: SimplesAnexo[] = ['I', 'II', 'III', 'IV', 'V'];

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// Regime tributário da empresa (11/08/2026). Até aqui o Tax Intelligence
// calculava certo e não tinha por onde receber o regime — bloqueava com
// REGIME_NAO_CONFIGURADO, que é o comportamento correto e inutilizável.
//
// Salvar NÃO sobrescreve: encerra a vigência atual e abre uma nova. É por isso
// que a data de início é obrigatória e o texto fala em "passa a valer".
export default function RegimeTributarioSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const vigenteQuery = useQuery({ queryKey: ['tax-regime', 'vigente'], queryFn: fetchRegimeVigente });

  const [uf, setUf] = useState('SP');
  const [regime, setRegime] = useState<TaxRegime>('SIMPLES_NACIONAL');
  const [anexo, setAnexo] = useState<SimplesAnexo>('I');
  const [vigenciaInicio, setVigenciaInicio] = useState('');
  const [meiValorFixoMensal, setMeiValorFixoMensal] = useState('');
  const [icmsAliquotaPct, setIcmsAliquotaPct] = useState('');
  const [presuncaoIrpjPct, setPresuncaoIrpjPct] = useState('');
  const [presuncaoCsllPct, setPresuncaoCsllPct] = useState('');
  const [aliquotaManualPct, setAliquotaManualPct] = useState('');

  const sugestaoQuery = useQuery({ queryKey: ['tax-regime', 'sugestao'], queryFn: fetchSugestaoDeAliquota });
  const sugestao = sugestaoQuery.data;

  const vigente = vigenteQuery.data;

  useEffect(() => {
    if (!vigente) return;
    setUf(vigente.uf);
    setRegime(vigente.regime);
    if (vigente.anexo) setAnexo(vigente.anexo);
    setMeiValorFixoMensal(vigente.meiValorFixoMensal !== null ? String(vigente.meiValorFixoMensal) : '');
    setIcmsAliquotaPct(vigente.icmsAliquotaPct !== null ? String(vigente.icmsAliquotaPct) : '');
    setPresuncaoIrpjPct(vigente.presuncaoIrpjPct !== null ? String(vigente.presuncaoIrpjPct) : '');
    setPresuncaoCsllPct(vigente.presuncaoCsllPct !== null ? String(vigente.presuncaoCsllPct) : '');
    setAliquotaManualPct(vigente.aliquotaManualPct !== null ? String(vigente.aliquotaManualPct) : '');
  }, [vigente]);

  const numeroOuNulo = (v: string) => (v.trim() === '' ? null : Number(v));
  const ehSimples = regime === 'SIMPLES_NACIONAL';
  const ehMei = regime === 'MEI_SIMEI';
  const ehNormal = regime === 'LUCRO_PRESUMIDO' || regime === 'LUCRO_REAL';

  const mutation = useMutation({
    mutationFn: () =>
      definirRegime({
        uf,
        regime,
        anexo: ehSimples ? anexo : null,
        vigenciaInicio: new Date(`${vigenciaInicio}T00:00:00Z`).toISOString(),
        meiValorFixoMensal: ehMei ? numeroOuNulo(meiValorFixoMensal) : null,
        icmsAliquotaPct: ehNormal ? numeroOuNulo(icmsAliquotaPct) : null,
        presuncaoIrpjPct: regime === 'LUCRO_PRESUMIDO' ? numeroOuNulo(presuncaoIrpjPct) : null,
        presuncaoCsllPct: regime === 'LUCRO_PRESUMIDO' ? numeroOuNulo(presuncaoCsllPct) : null,
        aliquotaManualPct: numeroOuNulo(aliquotaManualPct),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tax-regime'] });
      // A alíquota muda piso de preço e DRE — os dois precisam relerar.
      void queryClient.invalidateQueries({ queryKey: ['pricing'] });
      void queryClient.invalidateQueries({ queryKey: ['financial-intelligence'] });
    },
  });

  // Erros por campo vindos do backend. O cliente valida para UX; a negativa
  // real é sempre do servidor.
  const erros = problemasPorCampo(mutation.error);
  const podeSalvar = canEdit && vigenciaInicio !== '' && !mutation.isPending;

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Regime tributário</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Define como o imposto entra no piso de preço e nas deduções do DRE. Sem isto, o motor de preço bloqueia a
        decisão em vez de assumir alíquota zero.
      </p>

      {vigenteQuery.isLoading && <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>}

      {vigenteQuery.isError && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          Não foi possível carregar o regime atual: {extractErrorMessage(vigenteQuery.error)}{' '}
          <button type="button" onClick={() => void vigenteQuery.refetch()} className="underline underline-offset-2">
            Tentar de novo
          </button>
        </p>
      )}

      {!vigenteQuery.isLoading && !vigenteQuery.isError && !vigente && (
        <p className="mt-4 rounded-md border border-margin-warning/30 bg-margin-warning/5 px-3 py-2 text-sm text-margin-warning">
          Nenhum regime configurado ainda. Enquanto isso, o piso de preço e o DRE não conseguem calcular imposto.
        </p>
      )}

      {/* Sugestão de reajuste (13/08/2026).
          Só aparece quando o RBT12 ultrapassou a alíquota que o lojista mantém
          — ou seja, quando a margem de segurança dele deixou de existir. O
          número NÃO muda sozinho: ele aprova ou ignora. Mesmo padrão de
          "Sugestão de ação do anúncio" que já existe no Ads. */}
      {sugestao && (
        <div
          role="status"
          className="mt-4 rounded-md border border-margin-warning/30 bg-margin-warning/5 px-3 py-3 text-sm text-margin-warning"
        >
          <p className="font-medium">Seu faturamento subiu de faixa.</p>
          <p className="mt-1">
            A alíquota calculada agora é <strong>{formatarPct(sugestao.calculadaPct)}</strong> — acima dos{' '}
            <strong>{formatarPct(sugestao.atualPct)}</strong> que você usa, uma diferença de{' '}
            {formatarPct(sugestao.defasagemPctPontos)} para menos.
            {sugestao.folgaPreservadaPctPontos > 0 && (
              <> Sugerimos <strong>{formatarPct(sugestao.sugeridaPct)}</strong>, preservando sua folga de{' '}
              {formatarPct(sugestao.folgaPreservadaPctPontos)}.</>
            )}
            {sugestao.folgaPreservadaPctPontos === 0 && (
              <> Sugerimos <strong>{formatarPct(sugestao.sugeridaPct)}</strong>.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => setAliquotaManualPct(String(sugestao.sugeridaPct))}
              disabled={!canEdit}
            >
              Usar {formatarPct(sugestao.sugeridaPct)}
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              Preenche o campo abaixo. Nada muda até você escolher a data e salvar.
            </span>
          </div>
        </div>
      )}

      {vigente && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Info rotulo="Regime atual" valor={REGIMES.find((r) => r.valor === vigente.regime)?.rotulo ?? vigente.regime} />
          <Info rotulo="UF" valor={vigente.uf} />
          <Info rotulo="Anexo" valor={vigente.anexo ?? '—'} />
          <Info rotulo="Vigente desde" valor={vigente.vigenciaInicio.slice(0, 10).split('-').reverse().join('/')} />
        </dl>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
        <Campo rotulo="Regime" erro={erros.regime}>
          <select
            value={regime}
            onChange={(e) => setRegime(e.target.value as TaxRegime)}
            disabled={!canEdit}
            className={entradaClasse}
          >
            {REGIMES.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.rotulo}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            {REGIMES.find((r) => r.valor === regime)?.ajuda}
          </span>
        </Campo>

        <Campo rotulo="UF do estabelecimento" erro={erros.uf}>
          <select value={uf} onChange={(e) => setUf(e.target.value)} disabled={!canEdit} className={entradaClasse}>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Campo>

        {ehSimples && (
          <Campo rotulo="Anexo do Simples" erro={erros.anexo}>
            <select
              value={anexo}
              onChange={(e) => setAnexo(e.target.value as SimplesAnexo)}
              disabled={!canEdit}
              className={entradaClasse}
            >
              {ANEXOS.map((a) => (
                <option key={a} value={a}>
                  Anexo {a}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {ehMei && (
          <Campo rotulo="DAS fixo mensal (R$)" erro={erros.meiValorFixoMensal}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={meiValorFixoMensal}
              onChange={(e) => setMeiValorFixoMensal(e.target.value)}
              disabled={!canEdit}
              className={entradaClasse}
            />
          </Campo>
        )}

        {ehNormal && (
          <Campo rotulo="ICMS interno da UF (%)" erro={erros.icmsAliquotaPct}>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={icmsAliquotaPct}
              onChange={(e) => setIcmsAliquotaPct(e.target.value)}
              disabled={!canEdit}
              className={entradaClasse}
            />
          </Campo>
        )}

        {regime === 'LUCRO_PRESUMIDO' && (
          <>
            <Campo rotulo="Presunção IRPJ (%)" erro={erros.presuncaoIrpjPct}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={presuncaoIrpjPct}
                onChange={(e) => setPresuncaoIrpjPct(e.target.value)}
                disabled={!canEdit}
                className={entradaClasse}
              />
              <span className="mt-1 block text-xs text-muted-foreground">8% no comércio.</span>
            </Campo>
            <Campo rotulo="Presunção CSLL (%)" erro={erros.presuncaoCsllPct}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={presuncaoCsllPct}
                onChange={(e) => setPresuncaoCsllPct(e.target.value)}
                disabled={!canEdit}
                className={entradaClasse}
              />
              <span className="mt-1 block text-xs text-muted-foreground">12% no comércio.</span>
            </Campo>
          </>
        )}

        <Campo rotulo="Alíquota que você mantém (%)" erro={erros.aliquotaManualPct}>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={aliquotaManualPct}
            onChange={(e) => setAliquotaManualPct(e.target.value)}
            disabled={!canEdit}
            placeholder="deixe vazio para usar a calculada"
            className={entradaClasse}
          />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            Opcional. Se você mantém um percentual próprio — normalmente um pouco acima do calculado, como margem de
            segurança — informe aqui: ele é o que vale no piso de preço e no DRE. Vazio significa usar o cálculo do
            RBT12.
          </span>
        </Campo>

        <Campo rotulo="Passa a valer em" erro={erros.vigenciaInicio}>
          <input
            type="date"
            value={vigenciaInicio}
            onChange={(e) => setVigenciaInicio(e.target.value)}
            disabled={!canEdit}
            required
            className={entradaClasse}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Salvar não apaga o regime anterior: encerra a vigência dele na véspera desta data. Meses já apurados
            continuam sendo calculados com a regra que valia neles.
          </span>
        </Campo>
      </div>

      {mutation.isError && Object.keys(erros).length === 0 && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          {extractErrorMessage(mutation.error)}
        </p>
      )}

      {mutation.isSuccess && (
        <p className="mt-4 text-sm text-margin-good" role="status">
          Regime salvo. O piso de preço e o DRE passam a usar esta configuração.
        </p>
      )}

      <div className="mt-5">
        <Button onClick={() => mutation.mutate()} disabled={!podeSalvar}>
          {mutation.isPending ? 'Salvando…' : 'Salvar regime'}
        </Button>
        {!canEdit && (
          <span className="ml-3 text-xs text-muted-foreground">Somente Administrador pode alterar o regime.</span>
        )}
      </div>
    </Card>
  );
}

// Vírgula decimal e no máximo 2 casas — a precisão da coluna no banco. Mostrar
// 7,8000000001 na sugestão faria o número exibido divergir do que é gravado.
function formatarPct(valor: number): string {
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

const entradaClasse =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

// Rótulo real ligado ao controle, e mensagem de erro associada ao campo — não
// um bloco solto no topo do formulário.
function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-foreground">
      {rotulo}
      {children}
      {erro && (
        <span className="mt-1 block text-xs font-normal text-margin-danger" role="alert">
          {erro}
        </span>
      )}
    </label>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-foreground">{valor}</dd>
    </div>
  );
}
