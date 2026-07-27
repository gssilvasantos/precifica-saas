import { OrderStatus } from './order.entity';

// Reestruturação do sync ML (25-26/07/2026, ver README) — função pura,
// SEM I/O, mesmo padrão de order-transition-events.ts. Nasceu de um risco
// real identificado ao separar a busca rápida de pedidos (fast path, sem
// consulta de envio) do enriquecimento assíncrono e resumível
// (MercadoLivreShipmentEnrichmentJob): o Mercado Livre não expõe
// `shipping.status` de verdade em `/orders/search` (só uma referência,
// `{id}`) — sem uma consulta extra a `/shipments/{id}`, todo pedido pago
// normaliza para o fallback PREPARANDO_ENVIO (ver mapMercadoLivreStatus).
// Isso significa que uma resync INCREMENTAL comum (que roda a cada poucos
// minutos e não faz mais nenhuma consulta de envio) reencontraria o MESMO
// pedido, sem informação nova sobre o envio, e reescreveria seu status de
// volta para PREPARANDO_ENVIO — mesmo que o enriquecimento já tivesse
// confirmado ENVIADO/ENTREGUE antes. Sem esta guarda, o sistema "esqueceria"
// todo progresso de envio a cada sync incremental subsequente.
//
// Regra: o status unificado de um pedido nunca REGRIDE para um estágio
// anterior — a única exceção é virar CANCELADO, que pode acontecer a
// qualquer momento do ciclo (e, uma vez cancelado, o pedido é terminal e não
// volta a mudar sozinho por uma resync). Aplicada de forma genérica (não
// específica do Mercado Livre) no repositório — é uma invariante razoável
// para qualquer canal: nenhum e-commerce real "desenvia" ou "desentrega" um
// pedido sozinho.
const STAGE_RANK: Record<Exclude<OrderStatus, 'CANCELADO'>, number> = {
  EM_ABERTO: 0,
  PREPARANDO_ENVIO: 1,
  FATURADO: 2,
  ENVIADO: 3,
  ENTREGUE: 4,
};

export function resolveEffectiveStatus(previousStatus: OrderStatus | null, incomingStatus: OrderStatus): OrderStatus {
  if (previousStatus === null) return incomingStatus;

  // Cancelamento é sempre aplicado, de qualquer estágio.
  if (incomingStatus === 'CANCELADO') return 'CANCELADO';

  // CANCELADO é terminal — uma resync não "descancela" um pedido sozinha
  // (o canal não modela isso como uma transição normal).
  if (previousStatus === 'CANCELADO') return previousStatus;

  return STAGE_RANK[incomingStatus] >= STAGE_RANK[previousStatus] ? incomingStatus : previousStatus;
}
