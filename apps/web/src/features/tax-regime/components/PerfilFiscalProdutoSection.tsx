import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  classificarProduto,
  fetchPerfisDoProduto,
  fetchProdutosParaClassificar,
  FONTES_DE_CLASSIFICACAO,
  ROTULO_DA_FONTE,
  type FonteDeClassificacao,
} from '../perfil-produto-api';
import { extractErrorMessage } from '../../../lib/extract-error-message';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

interface Props {
  canEdit: boolean;
}

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const entrada =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

// Perfil fiscal do produto (12/08/2026) — o último bloqueio do Simples.
//
// A alíquota varia POR PRODUTO: ST e monofásico são atributos do item, não do
// tenant. E a chave inclui UF e data, porque ST é regime estadual e muda por
// portaria — o mesmo SKU tem classificações diferentes em SP e no PR, e antes
// e depois de uma data.
export default function PerfilFiscalProdutoSection({ canEdit }: Props) {
  const queryClient = useQueryClient();
  const produtosQuery = useQuery({ queryKey: ['tax-regime', 'produtos'], queryFn: fetchProdutosParaClassificar });

  const [productId, setProductId] = useState('');
  const [uf, setUf] = useState('SP');
  const [icmsSt, setIcmsSt] = useState(false);
  const [monofasico, setMonofasico] = useState(false);
  const [ncm, setNcm] = useState('');
  const [fonte, setFonte] = useState<FonteDeClassificacao>('MANUAL');
  const [vigenciaInicio, setVigenciaInicio] = useState('');

  const perfisQuery = useQuery({
    queryKey: ['tax-regime', 'perfil-produto', productId],
    queryFn: () => fetchPerfisDoProduto(productId),
    enabled: productId !== '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      classificarProduto(productId, {
        uf,
        icmsSt,
        monofasico,
        ncm: ncm.trim() === '' ? null : ncm.trim(),
        fonte,
        vigenciaInicio: new Date(`${vigenciaInicio}T00:00:00Z`).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tax-regime', 'perfil-produto', productId] });
      void queryClient.invalidateQueries({ queryKey: ['pricing'] });
    },
  });

  const produtos = produtosQuery.data ?? [];
  const podeSalvar = canEdit && productId !== '' && vigenciaInicio !== '' && !mutation.isPending;

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Classificação fiscal por produto</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Substituição tributária e PIS/Cofins monofásico são atributos do produto, não da empresa — e a ST é estadual,
        então a classificação vale por UF e por período. Sem isto, o cálculo do Simples bloqueia para o SKU.
      </p>

      {produtosQuery.isLoading && <p className="mt-4 text-sm text-muted-foreground">Carregando produtos…</p>}

      {produtosQuery.isError && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          Não foi possível carregar os produtos: {extractErrorMessage(produtosQuery.error)}{' '}
          <button type="button" onClick={() => void produtosQuery.refetch()} className="underline underline-offset-2">
            Tentar de novo
          </button>
        </p>
      )}

      {produtosQuery.isSuccess && produtos.length === 0 && (
        <p className="mt-4 rounded-md border border-border bg-surface/40 px-3 py-2 text-sm text-muted-foreground">
          Nenhum produto no catálogo ainda. Importe do Olist ou cadastre um produto antes de classificar.
        </p>
      )}

      {produtos.length > 0 && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
            <label className="block text-xs font-medium text-foreground sm:col-span-2">
              Produto
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                disabled={!canEdit}
                className={entrada}
              >
                <option value="">Selecione um produto…</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.skuCode} — {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-foreground">
              UF
              <select value={uf} onChange={(e) => setUf(e.target.value)} disabled={!canEdit} className={entrada}>
                {UFS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-foreground">
              NCM (opcional)
              <input
                value={ncm}
                onChange={(e) => setNcm(e.target.value)}
                placeholder="3304.99.90"
                disabled={!canEdit}
                className={entrada}
              />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Guardado como snapshot: corrigir o NCM no cadastro depois não muda um período já apurado.
              </span>
            </label>

            <label className="block text-xs font-medium text-foreground sm:col-span-2">
              Fundamentação
              <select
                value={fonte}
                onChange={(e) => setFonte(e.target.value as FonteDeClassificacao)}
                disabled={!canEdit}
                className={entrada}
              >
                {FONTES_DE_CLASSIFICACAO.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO_DA_FONTE[f]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                Quando a alíquota deste SKU mudar, a resposta a “por quê?” precisa ser a norma.
              </span>
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={icmsSt}
                onChange={(e) => setIcmsSt(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 rounded border-input"
              />
              Sujeito a ICMS-ST nesta UF
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={monofasico}
                onChange={(e) => setMonofasico(e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 rounded border-input"
              />
              PIS/Cofins monofásico
            </label>

            <label className="block text-xs font-medium text-foreground">
              Passa a valer em
              <input
                type="date"
                value={vigenciaInicio}
                onChange={(e) => setVigenciaInicio(e.target.value)}
                disabled={!canEdit}
                className={entrada}
              />
            </label>
          </div>

          {productId !== '' && (
            <div className="mt-5">
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Histórico deste produto</h3>
              {perfisQuery.isLoading && <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>}
              {perfisQuery.isSuccess && perfisQuery.data.length === 0 && (
                <p className="mt-2 rounded-md border border-margin-warning/30 bg-margin-warning/5 px-3 py-2 text-sm text-margin-warning">
                  Sem classificação ainda — o cálculo do Simples bloqueia para este SKU.
                </p>
              )}
              {perfisQuery.isSuccess && perfisQuery.data.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">UF</th>
                        <th className="py-2 pr-4 font-medium">ST</th>
                        <th className="py-2 pr-4 font-medium">Monofásico</th>
                        <th className="py-2 pr-4 font-medium">Vigência</th>
                        <th className="py-2 font-medium">Fundamentação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfisQuery.data.map((p) => (
                        <tr key={p.id} className="border-b border-border/50">
                          <td className="py-2 pr-4 text-foreground">{p.uf}</td>
                          <td className="py-2 pr-4">{p.icmsSt ? 'Sim' : 'Não'}</td>
                          <td className="py-2 pr-4">{p.monofasico ? 'Sim' : 'Não'}</td>
                          <td className="py-2 pr-4 text-muted-foreground">
                            {formatarData(p.vigenciaInicio)} — {p.vigenciaFim ? formatarData(p.vigenciaFim) : 'vigente'}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {ROTULO_DA_FONTE[p.fonte as FonteDeClassificacao] ?? p.fonte}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {mutation.isError && (
        <p className="mt-4 rounded-md border border-margin-danger/30 bg-margin-danger/5 px-3 py-2 text-sm text-margin-danger">
          {extractErrorMessage(mutation.error)}
        </p>
      )}

      {mutation.isSuccess && (
        <p className="mt-4 text-sm text-margin-good" role="status">
          Classificação registrada.
        </p>
      )}

      {produtos.length > 0 && (
        <div className="mt-5">
          <Button onClick={() => mutation.mutate()} disabled={!podeSalvar}>
            {mutation.isPending ? 'Salvando…' : 'Classificar produto'}
          </Button>
          {!canEdit && (
            <span className="ml-3 text-xs text-muted-foreground">Somente Administrador pode classificar.</span>
          )}
        </div>
      )}
    </Card>
  );
}

function formatarData(iso: string): string {
  return iso.slice(0, 10).split('-').reverse().join('/');
}
