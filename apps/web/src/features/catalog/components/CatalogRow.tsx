import { ChevronRight } from 'lucide-react';
import type { Product } from '../api';
import type { MarginStatusInfo } from '../margin-status';
import { Button } from '../../../components/ui/button';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export interface CatalogRowData {
  product: Product;
  avgPrice: number | null;
  marginPct: number | null;
  statusInfo: MarginStatusInfo;
}

interface Props {
  row: CatalogRowData;
  // Linha de variação: recuada, sem foto grande e com a grade no lugar do nome.
  isChild?: boolean;
  // Presente só em pai com variações: mostra a seta e o contador.
  variantCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
  onEdit: () => void;
  onPricing: () => void;
  // Só em produto que não é variação (a hierarquia tem um nível só).
  onGenerateVariants?: () => void;
}

function variantLabel(attrs: Product['variantAttributes']): string | null {
  if (!attrs) return null;
  const parts = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function CatalogRow({ row, isChild = false, variantCount, expanded = false, onToggle, onEdit, onPricing, onGenerateVariants }: Props) {
  const { product, avgPrice, marginPct, statusInfo } = row;
  const hasChildren = (variantCount ?? 0) > 0;
  const grade = isChild ? variantLabel(product.variantAttributes) : null;

  return (
    <tr className={`border-b border-border/60 last:border-0 hover:bg-muted/40 ${isChild ? 'bg-muted/20' : ''}`}>
      <td className="px-5 py-3">
        <div className={`flex items-center gap-2 ${isChild ? 'pl-6' : ''}`}>
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Recolher' : 'Expandir'} variações de ${product.name}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            // Reserva a largura da seta para as fotos ficarem alinhadas na coluna.
            !isChild && <span className="h-6 w-6 shrink-0" aria-hidden="true" />
          )}
          {product.photoUrls[0] ? (
            <img src={product.photoUrls[0]} alt={product.name} className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-[10px] text-muted-foreground">
              sem foto
            </div>
          )}
        </div>
      </td>
      <td className="px-5 py-3 font-medium text-foreground">
        {product.name}
        {hasChildren && (
          <span className="ml-2 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {variantCount} {variantCount === 1 ? 'variação' : 'variações'}
          </span>
        )}
        {grade && <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{grade}</span>}
      </td>
      <td className="px-5 py-3 font-sans text-foreground">{product.skuCode}</td>
      <td className="px-5 py-3 font-sans text-foreground">{currency.format(product.costPrice)}</td>
      <td className="px-5 py-3 font-sans text-foreground">
        {avgPrice !== null ? currency.format(avgPrice) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-5 py-3 font-sans font-semibold text-foreground">
        {marginPct !== null ? `${marginPct.toFixed(1)}%` : <span className="font-normal text-muted-foreground">—</span>}
      </td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusInfo.badgeClass}`}>{statusInfo.label}</span>
      </td>
      <td className="px-5 py-3">
        {product.ncm ? (
          <span className="font-sans text-foreground">{product.ncm}</span>
        ) : (
          // NCM ausente não é detalhe de cadastro: sem ele não há como classificar
          // o produto para fins tributários, nem emitir NF-e, nem publicar anúncio.
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            sem NCM
          </span>
        )}
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex justify-end gap-2">
          {!isChild && onGenerateVariants && (
            <Button variant="ghost" size="sm" onClick={onGenerateVariants}>
              Variações
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Editar
          </Button>
          <Button variant="outline" size="sm" onClick={onPricing}>
            Precificação
          </Button>
        </div>
      </td>
    </tr>
  );
}
