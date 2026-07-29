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
const STAGE_RANK: Record<Exclude<OrderStatus, 'CANCELADO' | 'NAO_ENTREGUE'>, number> = {
  EM_ABERTO: 0,
  APROVADO: 1,
  PREPARANDO_ENVIO: 2,
  FATURADO: 3,
  ENVIADO: 4,
  ENTREGUE: 5,
};

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 2.2) — NAO_ENTREGUE não entra em STAGE_RANK: diferente dos demais
// estágios, ele não representa "mais progresso", representa uma tentativa de
// entrega que FALHOU. Só faz sentido chegar nele depois de despachado
// (ENVIADO ou além) — e, diferente de CANCELADO, NÃO é terminal: uma
// reentrega bem-sucedida ainda pode levar a ENTREGUE, e um novo envio pode
// levar de volta a ENVIADO. Por isso NAO_ENTREGUE recebe um tratamento
// próprio em vez de um rank fixo na escada linear.
const NAO_ENTREGUE_MIN_RANK = STAGE_RANK.ENVIADO;

export function resolveEffectiveStatus(previousStatus: OrderStatus | null, incomingStatus: OrderStatus): OrderStatus {
  if (previousStatus === null) return incomingStatus;

  // Cancelamento é sempre aplicado, de qualquer estágio.
  if (incomingStatus === 'CANCELADO') return 'CANCELADO';

  // CANCELADO é terminal — uma resync não "descancela" um pedido sozinha
  // (o canal não modela isso como uma transição normal).
  if (previousStatus === 'CANCELADO') return previousStatus;

  if (incomingStatus === 'NAO_ENTREGUE') {
    if (previousStatus === 'NAO_ENTREGUE') return previousStatus;
    // Sinal só é confiável a partir de ENVIADO — um "não entregue" antes
    // disso seria incoerente (nunca chegou a ser despachado); nesse caso
    // ignoramos e mantemos o estágio anterior, mesmo racional de não
    // regredir usado no resto desta função.
    return STAGE_RANK[previousStatus] >= NAO_ENTREGUE_MIN_RANK ? 'NAO_ENTREGUE' : previousStatus;
  }

  if (previousStatus === 'NAO_ENTREGUE') {
    // Sai de NAO_ENTREGUE normalmente pra frente (reentrega -> ENVIADO de
    // novo, ou confirmação direta de ENTREGUE) — nunca "regride" pra um
    // estágio anterior a ENVIADO só porque uma resync incremental não trouxe
    // informação nova de envio.
    return STAGE_RANK[incomingStatus] >= NAO_ENTREGUE_MIN_RANK ? incomingStatus : previousStatus;
  }

  return STAGE_RANK[incomingStatus] >= STAGE_RANK[previousStatus] ? incomingStatus : previousStatus;
}
