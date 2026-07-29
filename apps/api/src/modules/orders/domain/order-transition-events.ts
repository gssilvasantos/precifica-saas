import { OrderStatus } from './order.entity';

export type OrderTransitionEvent = 'PAID' | 'CANCELLED' | 'READY_FOR_FULFILLMENT' | 'DELIVERY_FAILED';

// Função pura — decide quais eventos de domínio disparar quando um pedido
// muda de status, sem tocar em EventEmitter2/banco/HTTP. Isolada aqui
// (mesmo padrão de calculateOpportunity/resolveShippingDimensions) para ser
// testável sem DI e sem mock de repositório.
//
// Heurística de "pago" (MVP, documentada em docs/orders-architecture.md,
// seção 5): o modelo de worklist não tem um estágio "PAGO" isolado — Olist e
// a maioria dos canais tratam a confirmação de pagamento como a saída do
// estágio "Em aberto". Por isso: sair de EM_ABERTO pela primeira vez (ou já
// entrar direto num estágio além dele, em pedidos criados já pagos) é o
// gatilho de ORDER_EVENTS.PAID — não o campo paidAt em si (que pode vir
// nulo/impreciso de alguns canais).
export function determineOrderTransitionEvents(
  previousStatus: OrderStatus | null,
  newStatus: OrderStatus,
): OrderTransitionEvent[] {
  const events: OrderTransitionEvent[] = [];

  const wasEmAberto = previousStatus === null || previousStatus === 'EM_ABERTO';
  const isNowBeyondEmAberto = newStatus !== 'EM_ABERTO' && newStatus !== 'CANCELADO';
  if (wasEmAberto && isNowBeyondEmAberto) {
    events.push('PAID');
  }

  if (previousStatus !== 'CANCELADO' && newStatus === 'CANCELADO') {
    events.push('CANCELLED');
  }

  if (previousStatus !== 'PREPARANDO_ENVIO' && newStatus === 'PREPARANDO_ENVIO') {
    events.push('READY_FOR_FULFILLMENT');
  }

  // Benchmark Tiny ERP (28/07/2026, seção 2.2) — entrega tentada e
  // confirmada como falha é um problema logístico real que merece alerta
  // operacional (ver ORDER_EVENTS.DELIVERY_FAILED), não só uma mudança de
  // status silenciosa. Só dispara na TRANSIÇÃO (mesmo racional dos outros
  // eventos aqui), nunca a cada resync que confirma o mesmo NAO_ENTREGUE de novo.
  if (previousStatus !== 'NAO_ENTREGUE' && newStatus === 'NAO_ENTREGUE') {
    events.push('DELIVERY_FAILED');
  }

  return events;
}
