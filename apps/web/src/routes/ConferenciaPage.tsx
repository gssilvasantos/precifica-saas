import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchPendingQueue, type StockMovementAuditEvent } from '../features/logistics-fulfillment/audit-events-api';
import { Card } from '../components/ui/card';
import { buttonVariants } from '../components/ui/button';

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
        <h1 className="font-serif text-3xl font-semibold text-foreground">Conferência de Expedição</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fila de despachos aguardando bipagem e vídeo de conferência. O botão "Finalizar Embalagem" na tela de cada
          item só libera com 100% dos itens bipados e a gravação anexada.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Tipo</th>
                <th className="px-5 py-3 font-medium">Pedidos vinculados</th>
                <th className="px-5 py-3 font-medium">Criado em</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {queueQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    Carregando fila…
                  </td>
                </tr>
              )}

              {!queueQuery.isLoading && queue.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    Nenhum despacho pendente de conferência no momento.
                  </td>
                </tr>
              )}

              {queue.map((event) => (
                <tr key={event.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                  <td className="px-5 py-3 font-sans font-medium text-foreground">{EVENT_TYPE_LABEL[event.eventType]}</td>
                  <td className="px-5 py-3 text-foreground">
                    {event.orderIds.length > 0 ? `${event.orderIds.length} pedido(s)` : 'Reabastecimento preventivo'}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{dateTimeFormatter.format(new Date(event.createdAt))}</td>
                  <td className="px-5 py-3 text-right">
                    <Link to={`/conferencia/${event.id}`} className={buttonVariants({ size: 'sm' })}>
                      Abrir conferência
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
