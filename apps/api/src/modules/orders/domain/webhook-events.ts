// Evento de "notificação de webhook recebida" — emitido por
// WebhooksController (interface/controllers/webhooks.controller.ts) depois
// do nudge de pedidos (ver comentário no controller). Mesmo racional de
// ORDER_EVENTS (order-events.ts): um arquivo de constantes/tipos puro, sem
// nenhuma classe de aplicação, para que outro módulo (ex.: Financial
// Intelligence, ver payment-webhook.listener.ts) reaja ao TÓPICO do webhook
// sem importar OrdersModule — mesmo padrão de zero-import já usado por
// ReceivableFromOrderListener/CompetitorSignalListener.
//
// Conciliação por canal (13/10/2026, a pedido do Gui) é o primeiro
// consumidor: reage a topic === 'payments' do Mercado Livre. O controller
// nunca decide isso — só emite o evento com o tópico cru (lido, nunca
// aplicado como dado direto — ver AVISO DE HONESTIDADE no controller).
export const WEBHOOK_EVENTS = {
  RECEIVED: 'marketplace-webhook.received',
} as const;

export interface MarketplaceWebhookReceivedEvent {
  channel: string; // marketplaceCode normalizado em maiúsculas (ex.: "MERCADO_LIVRE")
  // Tópico do webhook, quando o canal envia um (Mercado Livre sempre envia
  // `topic` no corpo — orders_v2, payments, messages, etc.). Outros canais
  // podem não enviar; fica undefined nesse caso, e quem reage decide o que
  // fazer com um tópico ausente/desconhecido (nunca lança).
  topic?: string;
}
