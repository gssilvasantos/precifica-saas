import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchPendingQueue, type StockMovementAuditEvent } from '../features/logistics-fulfillment/audit-events-api';

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const EVENT_TYPE_LABEL: Record<StockMovementAuditEvent['eventType'], string> = {
  RETAIL_SHIPMENT: 'Envio ao Cliente',
  FULL_DISPATCH: 'Lote para o Full',
};

// Fila de trabalho do Hub de Provas / Pick & Pack (Sprint 27) — os eventos
// PENDENTES do tenant, mais antigos primeiro (FIFO, já ordenado pelo
// backend). É o ponto de entrada do operador: escolhe um item da fila para
// abrir a tela de conferência (checklist + câmera).
export default function ConferenciaPage() {
  const queueQuery = useQuery({
    queryKey: ['audit-events-pending'],
    queryFn: fetchPendingQueue,
    refetchInterval: 15000, // novos despachos chegam o tempo todo — mantém a fila viva sem precisar de F5
  });

  const queue = queueQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink-900">Conferência de Expedição</h1>
        <p className="mt-1 text-sm text-ink-500">
          Fila de despachos aguardando bipagem e vídeo de conferência. O botão "Finalizar Embalagem" na tela de cada
          item só libera com 100% dos itens bipados e a gravação anexada.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-ink-300/60 text-xs uppercase tracking-wide text-ink-500">
              <th className="px-5 py-3 font-medium">Tipo</th>
              <th className="px-5 py-3 font-medium">Pedidos vinculados</th>
              <th className="px-5 py-3 font-medium">Criado em</th>
              <th className="px-5 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {queueQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-ink-500">
                  Carregando fila…
                </td>
              </tr>
            )}

            {!queueQuery.isLoading && queue.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-ink-500">
                  Nenhum despacho pendente de conferência no momento.
                </td>
              </tr>
            )}

            {queue.map((event) => (
              <tr key={event.id} className="border-b border-ink-300/30 last:border-0 hover:bg-canvas/60">
                <td className="px-5 py-3 font-sans font-medium text-ink-900">{EVENT_TYPE_LABEL[event.eventType]}</td>
                <td className="px-5 py-3 text-ink-700">
                  {event.orderIds.length > 0 ? `${event.orderIds.length} pedido(s)` : 'Reabastecimento preventivo'}
                </td>
                <td className="px-5 py-3 text-ink-500">{dateTimeFormatter.format(new Date(event.createdAt))}</td>
                <td className="px-5 py-3 text-right">
                  <Link
                    to={`/conferencia/${event.id}`}
                    className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neon hover:text-ink-900"
                  >
                    Abrir conferência
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
