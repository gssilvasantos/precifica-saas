// Espelha 1:1 o `enum OrderStatus` do Prisma — duplicado de propósito
// (mesmo padrão de BuyBoxStatus/ReceivableStatus): o domínio não importa o
// client gerado do Prisma, só valores simples.
export type OrderStatus = 'EM_ABERTO' | 'PREPARANDO_ENVIO' | 'FATURADO' | 'ENVIADO' | 'ENTREGUE' | 'CANCELADO';

// Estados TERMINAIS — usados por regras que não devem reagir a um pedido
// que já saiu do fluxo ativo (ex.: reconciliação financeira, worklist).
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['ENTREGUE', 'CANCELADO'];

// Modo de Demonstração / Audit Mode — REAL é o padrão em toda leitura (a
// segregação "automática" pedida: quem não passa nada nunca vê pedido
// fictício). DEMO mostra SÓ os pedidos marcados isDemo=true — as duas
// visões nunca se misturam porque o filtro é aplicado no repositório
// (WHERE isDemo = ...), não deixado a cargo de cada chamador. Ver
// docs/audit-mode.md.
export type AppDataMode = 'REAL' | 'DEMO';

// Espelha 1:1 o `enum FiscalResponsibility` do Prisma (Etapa 17) — quem deve
// emitir a nota fiscal deste pedido. SELLER (default, caso mais comum) ou
// MARKETPLACE (alguns programas de venda da Amazon/Magalu faturam em nome
// do vendedor ou assumem a nota diretamente) — ver docs/orders-architecture.md,
// seção 12.
export type FiscalResponsibility = 'SELLER' | 'MARKETPLACE';

export interface OrderItem {
  id: string;
  orderId: string;
  skuCode: string | null;
  externalSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  // Imposto discriminado por item (Etapa 17) — nulo quando o canal não
  // expõe essa quebra (Nuvemshop hoje).
  taxAmount: number | null;
  // Custo de aquisição no momento do pedido (Etapa 19) — snapshot do custo
  // efetivo do produto (ver ProductCatalogReader), capturado pelo
  // OrderSyncOrchestrator quando o SKU do item resolve contra o catálogo.
  // Nulo em pedidos sincronizados antes desta etapa, ou quando o SKU nunca
  // resolveu — ver fallback em domain/order-margin.ts.
  costPrice: number | null;
}

export interface Order {
  id: string;
  tenantId: string;
  channelCode: string;
  externalOrderId: string;
  status: OrderStatus;
  externalStatus: string;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  // Normalização financeira (Etapa 17) — SEMPRE preenchidos pelo adapter do
  // canal, nunca calculados por um serviço de aplicação. netAmount, não
  // totalAmount, é o valor lido por ReceivableFromOrderListener — ver
  // docs/orders-architecture.md, seção 11.
  feeAmount: number;
  netAmount: number;
  currency: string;
  fiscalResponsibility: FiscalResponsibility;
  buyerTaxId: string | null;
  invoiceNumber: string | null;
  shippingDeadlineAt: Date | null;
  orderedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  // Modo de Demonstração (ver AppDataMode acima) — true só para pedidos
  // injetados por AuditSeederService, nunca por um sync real.
  isDemo: boolean;
  items: OrderItem[];
}

export interface OrderItemUpsertData {
  skuCode?: string;
  externalSku: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxAmount?: number;
  // Preenchido pelo OrderSyncOrchestrator no momento em que resolve o SKU
  // via ProductCatalogReader — nunca vem do RawOrderItemCandidate (o canal
  // não conhece nosso custo interno). Ausente quando o SKU não resolveu.
  costPrice?: number;
}

// Dados para o upsert idempotente do OrderSyncOrchestrator — a chave de
// negócio (tenantId, channelCode, externalOrderId) decide create vs. update;
// nunca gera uma segunda linha para o mesmo pedido.
export interface OrderUpsertData {
  tenantId: string;
  channelCode: string;
  externalOrderId: string;
  status: OrderStatus;
  externalStatus: string;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  totalAmount: number;
  feeAmount: number;
  netAmount: number;
  currency: string;
  fiscalResponsibility?: FiscalResponsibility;
  buyerTaxId?: string;
  invoiceNumber?: string;
  shippingDeadlineAt?: Date;
  orderedAt: Date;
  paidAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  rawPayload?: unknown;
  items: OrderItemUpsertData[];
  // Ausente/false em todo upsert de um OrderSyncOrchestrator real — só
  // AuditSeederService passa `true` aqui (Modo de Demonstração/Audit Mode).
  isDemo?: boolean;
}

export interface OrderListFilters {
  channelCode?: string;
  status?: OrderStatus;
  dateFrom?: Date;
  dateTo?: Date;
  // Ausente = 'REAL' (nunca mostra pedido de demonstração) — ver AppDataMode.
  dataMode?: AppDataMode;
}

export interface OrderListPage {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

// Contador por status — alimenta as abas da worklist (Em aberto, Preparando
// envio, Faturado, Enviado, Entregue) sem precisar de uma query por aba.
export type OrderStatusCounts = Record<OrderStatus, number>;
