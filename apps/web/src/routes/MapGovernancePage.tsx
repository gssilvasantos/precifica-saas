import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProducts, updateProductMapPrice } from '../features/catalog/api';
import { useAuth } from '../features/auth/auth-context';
import MapBulkImportPanel from '../features/catalog/components/MapBulkImportPanel';
import ProductAuditTrail from '../features/catalog/components/ProductAuditTrail';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

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
        <h1 className="font-serif text-3xl font-semibold text-foreground">Governança de Preço Mínimo (MAP)</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Piso definido pelo fornecedor/marca — o motor de precificação nunca aplica um preço abaixo do MAP, em
          hipótese alguma (defesa em três camadas, gate final antes de qualquer envio ao marketplace). Deixe em
          branco para remover a restrição de um SKU.
        </p>
      </div>

      {user?.role === 'ADMIN' && <MapBulkImportPanel />}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
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
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando produtos…
                  </td>
                </tr>
              )}

              {!productsQuery.isLoading && products.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum produto ainda.
                  </td>
                </tr>
              )}

              {products.map((product) => {
                const isEditing = editingId === product.id;
                const isExpanded = expandedId === product.id;
                return (
                  <Fragment key={product.id}>
                    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium text-foreground">{product.name}</td>
                      <td className="px-5 py-3 font-sans text-foreground">{product.skuCode}</td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {product.sourceSystem === 'ERP_OLIST' ? 'Olist' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-sans text-foreground">
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            autoFocus
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            placeholder="sem restrição"
                            className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        ) : product.mapPrice !== null ? (
                          <span className="font-semibold text-foreground">{currency.format(product.mapPrice)}</span>
                        ) : (
                          <span className="text-muted-foreground">sem restrição</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {canViewAudit && (
                            <Button variant="outline" size="sm" onClick={() => setExpandedId(isExpanded ? null : product.id)}>
                              {isExpanded ? 'Ocultar histórico' : 'Ver histórico'}
                            </Button>
                          )}
                          {canEditMap && !isEditing && (
                            <Button variant="outline" size="sm" onClick={() => startEdit(product.id, product.mapPrice)}>
                              Editar
                            </Button>
                          )}
                          {canEditMap && isEditing && (
                            <>
                              <Button size="sm" onClick={() => saveEdit(product.id)} disabled={updateMutation.isPending}>
                                {updateMutation.isPending ? 'Salvando…' : 'Salvar'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="hover:border-margin-danger hover:text-margin-danger"
                                onClick={() => setEditingId(null)}
                              >
                                Cancelar
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && canViewAudit && (
                      <tr className="border-b border-border/60 last:border-0">
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
      </Card>
    </div>
  );
}
