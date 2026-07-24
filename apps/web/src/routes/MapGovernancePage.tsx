import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProducts, updateProductMapPrice } from '../features/catalog/api';
import { useAuth } from '../features/auth/auth-context';
import MapBulkImportPanel from '../features/catalog/components/MapBulkImportPanel';
import ProductAuditTrail from '../features/catalog/components/ProductAuditTrail';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Governança de Preço Mínimo (MAP) — Bloco 2 do sprint de Layout/UI. Ver
// docs/map-price-governance-architecture.md para a regra de negócio (o
// Kyneti nunca envia ao marketplace um preço abaixo do MAP definido pelo
// fornecedor). Esta tela cobre os 3 caminhos que o backend já expõe:
// edição manual por SKU, importação em massa (CSV) e trilha de auditoria.
export default function MapGovernancePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // PATCH /products/:id aceita ADMIN e PRICING_EDITOR; audit-log e
  // bulk-import são ADMIN-only no backend — a UI espelha essa mesma régua,
  // nunca mostrando um botão que o backend vai recusar.
  const canEditMap = user?.role === 'ADMIN' || user?.role === 'PRICING_EDITOR';
  const canViewAudit = user?.role === 'ADMIN';

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: fetchProducts });
  const products = productsQuery.data ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ id, mapPrice }: { id: string; mapPrice: number | null }) => updateProductMapPrice(id, mapPrice),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      setEditingId(null);
    },
  });

  const startEdit = (productId: string, currentValue: number | null) => {
    setEditingId(productId);
    setDraftValue(currentValue !== null ? String(currentValue) : '');
  };

  const saveEdit = (productId: string) => {
    const trimmed = draftValue.trim();
    const mapPrice = trimmed === '' ? null : Number(trimmed);
    if (mapPrice !== null && (!Number.isFinite(mapPrice) || mapPrice <= 0)) return;
    updateMutation.mutate({ id: productId, mapPrice });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink-900">Governança de Preço Mínimo (MAP)</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-500">
          Piso definido pelo fornecedor/marca — o motor de precificação nunca aplica um preço abaixo do MAP, em
          hipótese alguma (defesa em três camadas, gate final antes de qualquer envio ao marketplace). Deixe em
          branco para remover a restrição de um SKU.
        </p>
      </div>

      {user?.role === 'ADMIN' && <MapBulkImportPanel />}

      <div className="overflow-x-auto rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Produto</th>
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-5 py-3 font-medium">Origem</th>
              <th className="px-5 py-3 font-medium">MAP atual</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {productsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Carregando produtos…
                </td>
              </tr>
            )}

            {!productsQuery.isLoading && products.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-500">
                  Nenhum produto ainda.
                </td>
              </tr>
            )}

            {products.map((product) => {
              const isEditing = editingId === product.id;
              const isExpanded = expandedId === product.id;
              return (
                <Fragment key={product.id}>
                  <tr className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                    <td className="px-5 py-3 font-medium text-ink-900">{product.name}</td>
                    <td className="px-5 py-3 font-sans text-ink-700">{product.skuCode}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-ink-300/40 px-2 py-0.5 text-[11px] font-medium text-ink-700">
                        {product.sourceSystem === 'ERP_OLIST' ? 'Olist' : 'Manual'}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-sans text-ink-700">
                      {isEditing ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          autoFocus
                          value={draftValue}
                          onChange={(e) => setDraftValue(e.target.value)}
                          placeholder="sem restrição"
                          className="w-28 rounded-lg border border-ink-300 px-2 py-1 text-sm focus:border-gold focus:outline-none"
                        />
                      ) : product.mapPrice !== null ? (
                        <span className="font-semibold text-ink-900">{currency.format(product.mapPrice)}</span>
                      ) : (
                        <span className="text-ink-500">sem restrição</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {canViewAudit && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : product.id)}
                            className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-ink-500"
                          >
                            {isExpanded ? 'Ocultar histórico' : 'Ver histórico'}
                          </button>
                        )}
                        {canEditMap && !isEditing && (
                          <button
                            type="button"
                            onClick={() => startEdit(product.id, product.mapPrice)}
                            className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-gold hover:text-gold"
                          >
                            Editar
                          </button>
                        )}
                        {canEditMap && isEditing && (
                          <>
                            <button
                              type="button"
                              onClick={() => saveEdit(product.id)}
                              disabled={updateMutation.isPending}
                              className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink-700 disabled:opacity-50"
                            >
                              {updateMutation.isPending ? 'Salvando…' : 'Salvar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded-lg border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-margin-danger hover:text-margin-danger"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && canViewAudit && (
                    <tr className="border-b border-ink-300/30 last:border-0">
                      <td colSpan={5} className="px-5 py-3">
                        <ProductAuditTrail productId={product.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
