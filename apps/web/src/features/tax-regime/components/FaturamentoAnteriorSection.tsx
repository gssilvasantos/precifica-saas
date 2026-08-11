import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchJanelaRbt12,
  salvarFaturamentoAnterior,
  type MesDaJanela,
  type OrigemDoMes,
} from '../faturamento-anterior-api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

interface Props {
  canEdit: boolean;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Faturamento anterior — a metade humana do RBT12 (11/08/2026).
//
// A alíquota do Simples sai do faturamento dos 12 meses ANTERIORES ao período
// de apuração. O Kyneti conhece os meses em que já havia pedidos; os anteriores
// à cobertura só o contador sabe. Sem eles o cálculo BLOQUEIA — somar histórico
// parcial produz alíquota menor que a devida, e imposto subestimado
// superestima margem.
export default function FaturamentoAnteriorSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const janelaQuery = useQuery({ queryKey: ['tax-regime', 'rbt12'], queryFn: () => fetchJanelaRbt12() });

  // Só os meses que o usuário digitou nesta sessão. Não copiamos a resposta da
  // API para o estado — o que está gravado vem sempre da query.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  useEffect(() => {
    // Nova janela carregada: descarta digitação pendente da anterior para não
    // gravar valor num mês que não está mais em tela.
    setRascunho({});
  }, [janelaQuery.data?.periodoApuracao]);

  const mutation = useMutation({
    mutationFn: () => {
      const linhas = Object.entries(rascunho)
        .filter(([, valor]) => valor.trim() !== '')
        .map(([competencia, valor]) => ({
          competencia: `${competencia}-01T00:00:00.000Z`,
          receitaMercadoInterno: Number(valor),
          receitaMercadoExterno: 0,
          fonte: 'MANUAL' as const,
        }));
      return salvarFaturamentoAnterior(linhas);
    },
    onSuccess: (janela) => {
      queryClient.setQueryData(['tax-regime', 'rbt12'], janela);
      setRascunho({});
      // A alíquota muda piso de preço e DRE.
      void queryClient.invalidateQueries({ queryKey: ['pricing'] });
      void queryClient.invalidateQueries({ queryKey: ['financial-intelligence'] });
    },
  });

  const janela = janelaQuery.data;
  const temRascunho = Object.values(rascunho).some((v) => v.trim() !== '');

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Faturamento anterior (RBT12)</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        A alíquota do Simples é calculada sobre o faturamento dos 12 meses anteriores. Os meses em que o Kyneti já
        tinha seus pedidos são preenchidos sozinhos; os anteriores precisam do número declarado — é o mesmo dado do
        quadro “receitas brutas anteriores” do PGDAS-D.
      </p>

      {janelaQuery.isLoading && <p className="mt-4 text-sm text-muted-foreground">Carregando janela…</p>}

      {janelaQuery.isError && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          Não foi possível carregar: {extractErrorMessage(janelaQuery.error)}{' '}
          <button type="button" onClick={() => void janelaQuery.refetch()} className="underline underline-offset-2">
            Tentar de novo
          </button>
        </p>
      )}

      {janela && (
        <>
          <div
            role="status"
            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
              janela.mesesFaltantes === 0
                ? 'border-margin-good/30 bg-margin-good/5 text-margin-good'
                : 'border-margin-warning/30 bg-margin-warning/5 text-margin-warning'
            }`}
          >
            {janela.mesesFaltantes === 0 ? (
              <>Janela completa — RBT12 de {MOEDA.format(janela.rbt12Parcial)}. O cálculo do Simples está liberado.</>
            ) : (
              <>
                Faltam {janela.mesesFaltantes} mês(es). Enquanto isso o cálculo fica bloqueado — somar histórico
                parcial produziria alíquota menor que a devida. Soma parcial: {MOEDA.format(janela.rbt12Parcial)}.
              </>
            )}
          </div>

          {/* Tabela densa em tela pequena: rolagem horizontal declarada, nunca
              quebra silenciosa. */}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Competência</th>
                  <th className="py-2 pr-4 font-medium">Origem</th>
                  <th className="py-2 pr-4 text-right font-medium">Apurado pelos pedidos</th>
                  <th className="py-2 text-right font-medium">Receita informada (R$)</th>
                </tr>
              </thead>
              <tbody>
                {janela.meses.map((mes) => (
                  <LinhaDoMes
                    key={mes.competencia}
                    mes={mes}
                    canEdit={canEdit}
                    valor={rascunho[mes.competencia] ?? ''}
                    onChange={(v) => setRascunho((r) => ({ ...r, [mes.competencia]: v }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mutation.isError && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          {extractErrorMessage(mutation.error)}
        </p>
      )}

      <div className="mt-5">
        <Button onClick={() => mutation.mutate()} disabled={!canEdit || !temRascunho || mutation.isPending}>
          {mutation.isPending ? 'Salvando…' : 'Salvar meses informados'}
        </Button>
        {!canEdit && (
          <span className="ml-3 text-xs text-muted-foreground">Somente Administrador pode informar faturamento.</span>
        )}
        {canEdit && !temRascunho && (
          <span className="ml-3 text-xs text-muted-foreground">Digite ao menos um mês para salvar.</span>
        )}
      </div>
    </Card>
  );
}

const ORIGEM_ROTULO: Record<OrigemDoMes, string> = {
  INFORMADA: 'Informada',
  PEDIDOS_KYNETI: 'Pedidos do Kyneti',
  FALTANDO: 'Falta informar',
};

function LinhaDoMes({
  mes,
  canEdit,
  valor,
  onChange,
}: {
  mes: MesDaJanela;
  canEdit: boolean;
  valor: string;
  onChange: (valor: string) => void;
}) {
  const [ano, m] = mes.competencia.split('-');
  const faltando = mes.origem === 'FALTANDO';
  const informado = mes.receitaMercadoInterno !== null ? mes.receitaMercadoInterno + (mes.receitaMercadoExterno ?? 0) : null;

  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-4 text-foreground">
        {m}/{ano}
      </td>
      <td className="py-2 pr-4">
        {/* Estado por escrito, não só por cor. */}
        <span className={faltando ? 'text-margin-warning' : 'text-muted-foreground'}>
          {ORIGEM_ROTULO[mes.origem]}
          {mes.fonte && mes.fonte !== 'MANUAL' ? ` (${mes.fonte})` : ''}
        </span>
      </td>
      <td className="py-2 pr-4 text-right text-muted-foreground">
        {mes.receitaDePedidos !== null ? MOEDA.format(mes.receitaDePedidos) : '—'}
      </td>
      <td className="py-2 text-right">
        <label className="sr-only" htmlFor={`receita-${mes.competencia}`}>
          Receita informada de {m}/{ano}
        </label>
        <input
          id={`receita-${mes.competencia}`}
          type="number"
          step="0.01"
          min="0"
          disabled={!canEdit}
          value={valor}
          placeholder={informado !== null ? String(informado) : faltando ? 'obrigatório' : 'opcional'}
          onChange={(e) => onChange(e.target.value)}
          className="w-36 rounded-md border border-input bg-background px-2 py-1 text-right text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </td>
    </tr>
  );
}
