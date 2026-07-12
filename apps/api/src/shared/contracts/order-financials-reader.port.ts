// Modo de Demonstração / Audit Mode — espelha 1:1 orders/domain/order.entity.ts
// (mesma disciplina de DTO autocontido do resto deste arquivo: o Financial
// Intelligence não importa o tipo de dentro de Orders, só duplica o valor).
// Ausente = 'REAL' — garante que o DRE nunca mistura pedido de demonstração
// com dado real "por padrão". Ver docs/audit-mode.md.
export type AppDataMode = 'REAL' | 'DEMO';

// Porta de LEITURA exposta pelo Orders — consumida pelo Financial
// Intelligence (Etapa 20, FinancialOrchestrator/DRE) para consolidar
// desempenho financeiro por canal, sem que o Financial Intelligence precise
// importar a classe concreta OrdersService nem o domínio interno de Orders
// (mesma disciplina de Ports & Adapters de ProductCatalogReader/
// ChannelListingReader: o DTO abaixo é AUTOCONTIDO, não um espelho de
// `Order`/`OrderItem` — só os campos que um consumidor de relatório
// financeiro precisa).
//
// O custo (`costPriceUsed`/`costKnown`) já vem RESOLVIDO pelo Orders — quem
// decide "snapshot do pedido vs. custo atual do produto vs. desconhecido" é
// sempre `orders/domain/order-margin.ts` (Etapa 19), nunca o consumidor.
// Isso evita que o Financial Intelligence reimplemente essa lógica de
// fallback (e definitivamente evita que ele acesse ProductCatalogReader
// diretamente só para recalcular algo que o Orders já resolveu).
export interface OrderFinancialLineItem {
  skuCode: string | null;
  quantity: number;
  totalPrice: number;
  taxAmount: number | null;
  // Custo unitário já resolvido (snapshot do pedido OU custo atual do
  // produto, via fallback do Orders) — null quando nem um nem outro existe.
  costPriceUsed: number | null;
  // false quando nem o snapshot do pedido nem o custo atual do produto
  // estavam disponíveis (equivalente a costSource === 'UNKNOWN' em
  // orders/domain/order-margin.ts). É o sinal que alimenta a regra de ouro
  // de integridade de dados do DRE (ver financial-intelligence/domain/dre-report.ts).
  costKnown: boolean;
}

export interface OrderFinancialLine {
  orderId: string;
  externalOrderId: string;
  channelCode: string;
  status: string; // mantido como string (não o enum de Orders) — DTO autocontido, ver aviso acima
  orderedAt: Date;
  totalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  feeAmount: number; // comissão do marketplace deduzida deste pedido (Etapa 17) — 0 é um valor válido
  items: OrderFinancialLineItem[];
}

// Sprint 27 (Pick & Pack) — item mínimo para montar o checklist de
// bipagem do Hub de Provas (logistics-fulfillment). DTO autocontido, mesma
// disciplina de OrderFinancialLineItem: só skuCode/quantity, nada de
// preço/imposto/custo (este consumidor não precisa disso).
export interface OrderItemForFulfillment {
  orderId: string;
  skuCode: string | null;
  quantity: number;
}

export interface OrderFinancialsReader {
  // Sem paginação de propósito — este método serve relatórios agregados de
  // um período (DRE), não uma tela paginada. Ver aviso de escala em
  // orders/infrastructure/prisma-order.repository.ts (findAllForPeriod).
  // dataMode ausente = 'REAL' (Audit Mode) — o DRE só vê pedido fictício
  // quando o chamador pede explicitamente 'DEMO'.
  listForPeriod(tenantId: string, dateFrom?: Date, dateTo?: Date, dataMode?: AppDataMode): Promise<OrderFinancialLine[]>;

  // Sprint 27 — itens de um CONJUNTO ESPECÍFICO de pedidos (não um período),
  // usado por StockMovementAuditEventService.createPending para montar o
  // checklist de bipagem no momento em que o evento de auditoria nasce.
  // Método separado de listForPeriod de propósito: quem só quer os itens de
  // pedidos já conhecidos não deveria montar um filtro de data para isso.
  findItemsForOrders(tenantId: string, orderIds: string[]): Promise<OrderItemForFulfillment[]>;
}
