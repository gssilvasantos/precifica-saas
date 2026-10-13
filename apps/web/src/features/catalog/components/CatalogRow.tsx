import { ChevronRight, MoreHorizontal } from 'lucide-react';
import type { Product } from '../api';
import type { MarginStatusInfo } from '../margin-status';
import { Button } from '../../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export interface CatalogRowData {
  product: Product;
  avgPrice: number | null;
  marginPct: number | null;
  statusInfo: MarginStatusInfo;
}

interface Props {
  row: CatalogRowData;
  // Linha de variação: recuada, com a grade no lugar da legenda.
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

// As colunas "secundárias" somem em telas menores (hidden + md/lg/xl:table-cell)
// em vez de forçar rolagem horizontal: a tabela sempre cabe na página.
export const CELL = 'px-3 py-3 align-middle';

export default function CatalogRow({ row, isChild = false, variantCount, expanded = false, onToggle, onEdit, onPricing, onGenerateVariants }: Props) {
  const { product, avgPrice, marginPct, statusInfo } = row;
  const hasChildren = (variantCount ?? 0) > 0;
  const grade = isChild ? variantLabel(product.variantAttributes) : null;

  return (
    <tr className={`border-b border-border/60 last:border-0 hover:bg-muted/40 ${isChild ? 'bg-muted/20' : ''}`}>
      <td className={CELL}>
        <div className={`flex min-w-0 items-center gap-2 ${isChild ? 'pl-8' : ''}`}>
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Recolher' : 'Expandir'} variações de ${product.name}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            // Reserva a largura da seta para as fotos ficarem alinhadas na coluna.
            !isChild && <span className="h-7 w-7 shrink-0" aria-hidden="true" />
          )}
          {product.photoUrls[0] ? (
            <img src={product.photoUrls[0]} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-center text-[9px] leading-tight text-muted-foreground">
              sem foto
            </div>
          )}
          <div className="min-w-0">
            <p className="line-clamp-3 break-words text-sm font-medium text-foreground" title={product.name}>
              {product.name}
              {hasChildren && (
                <span className="ml-2 whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {variantCount} {variantCount === 1 ? 'variação' : 'variações'}
                </span>
              )}
            </p>
            <p className="truncate font-sans text-xs text-muted-foreground">
              {product.skuCode}
              {grade && <span> · {grade}</span>}
            </p>
          </div>
        </div>
      </td>
      <td className={`${CELL} hidden whitespace-nowrap font-sans text-sm text-foreground md:table-cell`}>
        {currency.format(product.costPrice)}
      </td>
      <td className={`${CELL} hidden whitespace-nowrap font-sans text-sm text-foreground lg:table-cell`}>
        {avgPrice !== null ? currency.format(avgPrice) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className={`${CELL} whitespace-nowrap font-sans text-sm font-semibold text-foreground`}>
        {marginPct !== null ? `${marginPct.toFixed(1)}%` : <span className="font-normal text-muted-foreground">—</span>}
      </td>
      <td className={`${CELL} hidden sm:table-cell`}>
        <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusInfo.badgeClass}`}>
          {statusInfo.label}
        </span>
      </td>
      <td className={`${CELL} hidden whitespace-nowrap text-sm xl:table-cell`}>
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
      <td className={`${CELL} text-right`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`Ações de ${product.name}`} className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
            <DropdownMenuItem onSelect={onPricing}>Precificação</DropdownMenuItem>
            {!isChild && onGenerateVariants && <DropdownMenuItem onSelect={onGenerateVariants}>Gerar variações</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
