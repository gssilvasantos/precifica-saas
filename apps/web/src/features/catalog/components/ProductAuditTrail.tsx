import { useQuery } from '@tanstack/react-query';
import { fetchProductAuditLog } from '../api';

interface Props {
  productId: string;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatMapValue(raw: string | null): string {
  if (raw === null) return 'sem restrição';
  const n = Number(raw);
  return Number.isFinite(n) ? currency.format(n) : raw;
}

const SOURCE_LABEL: Record<string, string> = { MANUAL: 'Manual', BULK_IMPORT: 'Importação em massa' };

// Trilha de auditoria de campos de governança (hoje só mapPrice) — quem
// mudou, quando, de/para qual valor. Espelha 1:1
// GET /products/:id/audit-log (ProductAuditLogService.listForProduct).
export default function ProductAuditTrail({ productId }: Props) {
  const auditQuery = useQuery({
    queryKey: ['products', productId, 'audit-log'],
    queryFn: () => fetchProductAuditLog(productId),
  });

  const entries = auditQuery.data ?? [];

  return (
    <div className="rounded-lg bg-canvas px-4 py-3">
      {auditQuery.isLoading && <p className="text-xs text-ink-500">Carregando histórico…</p>}
      {!auditQuery.isLoading && entries.length === 0 && (
        <p className="text-xs text-ink-500">Nenhuma mudança de MAP registrada para este produto ainda.</p>
      )}
      {entries.length > 0 && (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="text-xs">
              <span className="font-medium text-ink-900">{formatMapValue(entry.oldValue)}</span>
              <span className="mx-1 text-ink-500">→</span>
              <span className="font-medium text-ink-900">{formatMapValue(entry.newValue)}</span>
              <span className="ml-2 text-ink-500">
                · {SOURCE_LABEL[entry.source] ?? entry.source} · {dateFormat.format(new Date(entry.changedAt))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
