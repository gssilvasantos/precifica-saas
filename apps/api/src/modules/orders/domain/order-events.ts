// Mesma convenção de eventos de domínio do resto da plataforma (string +
// payload tipado, via EventEmitter2). Todos os três só disparam em
// TRANSIÇÃO (o orquestrador compara o status anterior com o novo antes de
// emitir) — reimportar o mesmo pedido sem mudança de status não deve gerar
// efeito colateral duplicado (idempotência de evento, não só de linha).
export const ORDER_EVENTS = {
  // Consumido pelo Financial Intelligence (ReceivableFromOrderListener) para
  // criar o ReceivableRecord correspondente — ver docs/orders-architecture.md,
  // seção 5.
  PAID: 'orders.order-paid',
  // Consumido pelo Financial Intelligence para cancelar um ReceivableRecord
  // já criado, se um pedido pago vier a ser cancelado depois.
  CANCELLED: 'orders.order-cancelled',
  // Gatilho operacional (pedido explícito): ponto de extensão para um
  // futuro módulo de Nota Fiscal/Etiqueta assinar sem que Orders precise
  // conhecê-lo — ver docs/orders-architecture.md, seção 8. Nenhum
  // consumidor existe ainda.
  READY_FOR_FULFILLMENT: 'orders.ready-for-fulfillment',
  // Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md,
  // seção 2.2) — entrega tentada e confirmada como falha (NAO_ENTREGUE).
  // Consumido diretamente por OrderSyncOrchestrator para emitir um alerta
  // operacional (mesmo AlertService já usado pra falha de sync) — não tem um
  // listener em outro módulo ainda, mas fica registrado aqui pelo mesmo
  // motivo dos demais: ponto de extensão único, sem acoplar quem dispara a
  // quem eventualmente reagir.
  DELIVERY_FAILED: 'orders.delivery-failed',
} as const;

export interface OrderPaidEvent {
  tenantId: string;
  orderId: string;
  channelCode: string;
  externalOrderId: string;
  // Mantido por compatibilidade/auditoria (valor bruto que o cliente pagou).
  totalAmount: number;
  // Etapa 17: o que o vendedor de fato recebe (totalAmount - comissão do
  // canal) — é ESTE campo, não totalAmount, que ReceivableFromOrderListener
  // usa para criar o ReceivableRecord. Ver docs/orders-architecture.md, seção 11.
  netAmount: number;
  paidAt: Date;
}

export interface OrderCancelledEvent {
  tenantId: string;
  orderId: string;
  channelCode: string;
  externalOrderId: string;
  cancelledAt: Date;
}

export interface OrderReadyForFulfillmentEvent {
  tenantId: string;
  orderId: string;
  channelCode: string;
  externalOrderId: string;
  skuCodes: string[]; // apenas os itens já resolvidos para um SKU interno
}

export interface OrderDeliveryFailedEvent {
  tenantId: string;
  orderId: string;
  channelCode: string;
  externalOrderId: string;
}
