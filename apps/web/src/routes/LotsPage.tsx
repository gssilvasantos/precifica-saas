import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../features/auth/auth-context';
import { fetchProducts, updateProductControlaLote } from '../features/catalog/api';
import { fetchWarehouses } from '../features/logistics-fulfillment/api';
import {
  adjustLotStock,
  createProductLot,
  fetchFefoSuggestion,
  fetchLotBalances,
  fetchProductLots,
  setProductLotStatus,
  type CreateProductLotInput,
  type LotAdjustmentMovementType,
} from '../features/product-lots/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { extractErrorMessage } from '../lib/extract-error-message';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const inputClass =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function emptyLotForm(): { lotCode: string; dataFabricacao: string; dataValidade: string; diasPermitidoVenda: string; codigoAgregacao: string } {
  return { lotCode: '', dataFabricacao: '', dataValidade: '', diasPermitidoVenda: '', codigoAgregacao: '' };
}

// Cadastro de lote (Catalog, por produto) — pré-requisito: Product.controlaLote
// precisa estar true. Se não estiver, oferecemos ativar direto daqui em vez
// de mandar o usuário procurar o campo em outra tela.
function ProductLotsSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyLotForm());

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const products = productsQuery.data ?? [];
  const selectedProduct = products.find((p) => p.id === productId) ?? null;

  const lotsQuery = useQuery({
    queryKey: ['product-lots', productId],
    queryFn: () => fetchProductLots(productId),
    enabled: productId !== '',
  });
  const lots = lotsQuery.data ?? [];

  const enableLoteMutation = useMutation({
    mutationFn: () => updateProductControlaLote(productId, true),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const createLotMutation = useMutation({
    mutationFn: (input: CreateProductLotInput) => createProductLot(productId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['product-lots', productId] });
      setShowForm(false);
      setForm(emptyLotForm());
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ lotCode, status }: { lotCode: string; status: 'ATIVO' | 'INATIVO' }) => setProductLotStatus(productId, lotCode, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['product-lots', productId] }),
  });

  const canSubmit = form.lotCode.trim() !== '' && form.dataValidade !== '';

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Cadastro de lotes</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Validade e janela de bloqueio de venda por lote — pré-requisito para lançar movimentação de estoque por lote
        abaixo.
      </p>

      <label className="mt-3 block text-xs font-medium text-foreground sm:max-w-md">
        Produto
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}>
          <option value="">Selecione um produto…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.skuCode} — {p.name}
            </option>
          ))}
        </select>
      </label>

      {selectedProduct && !selectedProduct.controlaLote && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-margin-warning/40 bg-margin-warning/10 p-3">
          <p className="text-xs text-foreground">
            Este produto ainda não tem controle de lote ativado — ative para poder cadastrar lotes.
          </p>
          {canEdit && (
            <Button size="sm" disabled={enableLoteMutation.isPending} onClick={() => enableLoteMutation.mutate()}>
              {enableLoteMutation.isPending ? 'Ativando…' : 'Ativar controle de lote'}
            </Button>
          )}
        </div>
      )}

      {selectedProduct?.controlaLote && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Lotes de {selectedProduct.skuCode}</h3>
            {canEdit && !showForm && (
              <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
                Novo lote
              </Button>
            )}
          </div>

          {showForm && (
            <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-foreground">
                Código do lote
                <input value={form.lotCode} onChange={(e) => setForm((f) => ({ ...f, lotCode: e.target.value }))} className={inputClass} />
              </label>
              <label className="text-xs font-medium text-foreground">
                Data de validade
                <input
                  type="date"
                  value={form.dataValidade}
                  onChange={(e) => setForm((f) => ({ ...f, dataValidade: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium text-foreground">
                Data de fabricação (opcional)
                <input
                  type="date"
                  value={form.dataFabricacao}
                  onChange={(e) => setForm((f) => ({ ...f, dataFabricacao: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium text-foreground">
                Dias de bloqueio antes do vencimento (opcional)
                <input
                  type="number"
                  min={0}
                  value={form.diasPermitidoVenda}
                  onChange={(e) => setForm((f) => ({ ...f, diasPermitidoVenda: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-medium text-foreground sm:col-span-2">
                Código de agregação (opcional)
                <input
                  value={form.codigoAgregacao}
                  onChange={(e) => setForm((f) => ({ ...f, codigoAgregacao: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <div className="sm:col-span-2 flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!canSubmit || createLotMutation.isPending}
                  onClick={() =>
                    createLotMutation.mutate({
                      lotCode: form.lotCode.trim(),
                      dataValidade: form.dataValidade,
                      dataFabricacao: form.dataFabricacao === '' ? undefined : form.dataFabricacao,
                      diasPermitidoVenda: form.diasPermitidoVenda === '' ? undefined : Number(form.diasPermitidoVenda),
                      codigoAgregacao: form.codigoAgregacao.trim() === '' ? undefined : form.codigoAgregacao.trim(),
                    })
                  }
                >
                  {createLotMutation.isPending ? 'Salvando…' : 'Salvar lote'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                {createLotMutation.isError && (
                  <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(createLotMutation.error)}</span>
                )}
              </div>
            </div>
          )}

          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Lote</th>
                <th className="py-1.5 pr-3 font-medium">Validade</th>
                <th className="py-1.5 pr-3 font-medium">Bloqueio (dias)</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                {canEdit && <th className="py-1.5"></th>}
              </tr>
            </thead>
            <tbody>
              {lots.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    Nenhum lote cadastrado para este produto.
                  </td>
                </tr>
              )}
              {lots.map((lot) => (
                <tr key={lot.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3 font-sans text-foreground">{lot.lotCode}</td>
                  <td className="py-1.5 pr-3 text-foreground">{dateFormatter.format(new Date(lot.dataValidade))}</td>
                  <td className="py-1.5 pr-3 text-foreground">{lot.diasPermitidoVenda}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={lot.status === 'ATIVO' ? 'success' : 'secondary'}>{lot.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  {canEdit && (
                    <td className="py-1.5 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={toggleStatusMutation.isPending}
                        onClick={() => toggleStatusMutation.mutate({ lotCode: lot.lotCode, status: lot.status === 'ATIVO' ? 'INATIVO' : 'ATIVO' })}
                      >
                        {lot.status === 'ATIVO' ? 'Desativar' : 'Ativar'}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// Movimentação e saldo por lote (Logistics Fulfillment) — depósito + SKU,
// nunca cria lote (isso é a seção acima); só lança Entrada/Saída/Balanço e
// consulta saldo/sugestão FEFO.
function LotStockSection({ canEdit }: { canEdit: boolean }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [movementType, setMovementType] = useState<LotAdjustmentMovementType>('ENTRADA');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [fefoQuantity, setFefoQuantity] = useState('');

  const warehousesQuery = useQuery({ queryKey: ['warehouses'], queryFn: fetchWarehouses });
  const warehouses = warehousesQuery.data ?? [];

  const balancesQuery = useQuery({
    queryKey: ['lot-balances', warehouseId, skuCode],
    queryFn: () => fetchLotBalances(warehouseId, skuCode),
    enabled: warehouseId !== '' && skuCode.trim() !== '',
  });
  const balances = balancesQuery.data ?? [];

  const fefoMutation = useMutation({
    mutationFn: () => fetchFefoSuggestion(warehouseId, skuCode, Number(fefoQuantity)),
  });

  const adjustMutation = useMutation({
    mutationFn: () =>
      adjustLotStock({
        warehouseId,
        skuCode: skuCode.trim(),
        lotCode: lotCode.trim(),
        movementType,
        quantity: Number(quantity),
        notes: notes.trim(),
      }),
    onSuccess: () => {
      void balancesQuery.refetch();
      setLotCode('');
      setQuantity('');
      setNotes('');
    },
  });

  const canAdjust =
    warehouseId !== '' && skuCode.trim() !== '' && lotCode.trim() !== '' && Number(quantity) > 0 && notes.trim().length > 0;

  return (
    <Card className="p-5">
      <h2 className="font-serif text-xl font-semibold text-foreground">Movimentação e saldo por lote</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Lançamento manual (Entrada/Saída/Balanço), saldo por lote num depósito, e sugestão FEFO de quais lotes
        consumir primeiro.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Depósito
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} ({w.type === 'VIRTUAL_FULL' ? 'Full' : 'Físico'})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-foreground">
          SKU
          <input value={skuCode} onChange={(e) => setSkuCode(e.target.value)} placeholder="Código do produto" className={inputClass} />
        </label>
      </div>

      {warehouseId !== '' && skuCode.trim() !== '' && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Lote</th>
                <th className="py-1.5 pr-3 font-medium">Saldo</th>
                <th className="py-1.5 pr-3 font-medium">Validade</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {balancesQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!balancesQuery.isLoading && balances.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-muted-foreground">
                    Sem movimentações registradas para este SKU neste depósito.
                  </td>
                </tr>
              )}
              {balances.map((b) => (
                <tr key={b.lotCode} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3 font-sans text-foreground">{b.lotCode}</td>
                  <td className="py-1.5 pr-3 font-sans text-foreground">{b.balance}</td>
                  <td className="py-1.5 pr-3 text-foreground">{dateFormatter.format(new Date(b.dataValidade))}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={b.status === 'ATIVO' ? 'success' : 'secondary'}>{b.status === 'ATIVO' ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rounded-lg border border-dashed border-border p-3">
            <p className="text-xs font-medium text-foreground">Sugestão FEFO</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                placeholder="Quantidade a consumir"
                value={fefoQuantity}
                onChange={(e) => setFefoQuantity(e.target.value)}
                className={inputClass + ' w-48'}
              />
              <Button size="sm" disabled={Number(fefoQuantity) <= 0 || fefoMutation.isPending} onClick={() => fefoMutation.mutate()}>
                {fefoMutation.isPending ? 'Calculando…' : 'Sugerir'}
              </Button>
            </div>
            {fefoMutation.data && (
              <div className="mt-2 text-xs text-foreground">
                {fefoMutation.data.allocations.length === 0 ? (
                  <p className="text-muted-foreground">Nenhum lote vendável disponível.</p>
                ) : (
                  <ul className="space-y-1">
                    {fefoMutation.data.allocations.map((a) => (
                      <li key={a.lotCode}>
                        {a.lotCode}: {a.quantity} unidade(s)
                      </li>
                    ))}
                  </ul>
                )}
                {!fefoMutation.data.fullyAllocated && (
                  <p className="mt-1 font-medium text-margin-warning">Faltam {fefoMutation.data.shortfall} unidade(s) para cobrir a quantidade pedida.</p>
                )}
              </div>
            )}
          </div>

          {canEdit && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-foreground">Lançar movimento</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} placeholder="Código do lote" className={inputClass} />
                <select value={movementType} onChange={(e) => setMovementType(e.target.value as LotAdjustmentMovementType)} className={inputClass}>
                  <option value="ENTRADA">Entrada</option>
                  <option value="SAIDA">Saída</option>
                  <option value="BALANCO">Balanço (contagem física)</option>
                </select>
                <input
                  type="number"
                  min={1}
                  placeholder="Quantidade"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={inputClass}
                />
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Justificativa" className={inputClass} />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" disabled={!canAdjust || adjustMutation.isPending} onClick={() => adjustMutation.mutate()}>
                  {adjustMutation.isPending ? 'Lançando…' : 'Lançar'}
                </Button>
                {adjustMutation.isError && (
                  <span className="text-xs font-medium text-margin-danger">{extractErrorMessage(adjustMutation.error)}</span>
                )}
                {adjustMutation.isSuccess && <span className="text-xs font-medium text-margin-good">Lançado.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function LotsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-foreground">Lotes (FEFO / Validade)</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Cadastro de lote por produto, movimentação de estoque por lote e sugestão de consumo FEFO (primeiro a
          vencer, primeiro a sair).
        </p>
        {!canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">
            Você tem acesso somente leitura — cadastrar lotes e lançar movimentação é restrito a
            Administrador/Editor de Preços.
          </p>
        )}
      </div>

      <ProductLotsSection canEdit={canEdit} />
      <LotStockSection canEdit={canEdit} />
    </div>
  );
}
