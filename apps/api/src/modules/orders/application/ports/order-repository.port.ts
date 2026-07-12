import {
  AppDataMode,
  Order,
  OrderListFilters,
  OrderListPage,
  OrderStatus,
  OrderStatusCounts,
  OrderUpsertData,
} from '../../domain/order.entity';

export interface OrderUpsertResult {
  order: Order;
  isNew: boolean;
  // Status ANTES deste upsert — null quando isNew=true. É o que permite ao
  // OrderSyncOrchestrator detectar TRANSIÇÃO de status (e só então emitir
  // ORDER_EVENTS.PAID/CANCELLED/READY_FOR_FULFILLMENT), em vez de reagir a
  // toda sincronização de um pedido que não mudou.
  previousStatus: OrderStatus | null;
}

export interface OrderRepository {
  upsert(data: OrderUpsertData): Promise<OrderUpsertResult>;
  findById(tenantId: string, id: string): Promise<Order | null>;
  // Filtros + paginação resolvidos NO BANCO (WHERE + LIMIT/OFFSET) — Order é
  // uma tabela transacional que cresce sem limite, diferente de
  // Product/Packaging (cadastro pequeno, filtro em memória aceitável hoje).
  // Ver docs/orders-architecture.md, seção 6, para o racional de performance.
  findWithFilters(tenantId: string, filters: OrderListFilters, page: number, pageSize: number): Promise<OrderListPage>;
  // Alimenta os contadores das abas da worklist — um GROUP BY, não N queries.
  // dataMode ausente = 'REAL' (Audit Mode, ver domain/order.entity.ts).
  countByStatus(tenantId: string, dataMode?: AppDataMode): Promise<OrderStatusCounts>;
  // Etapa 20 (DRE) — busca TODOS os pedidos do período, sem paginação de
  // propósito: relatório agregado, não tela de worklist. Aviso de escala:
  // aceitável para o volume de MVP (mesmo racional documentado em
  // findWithFilters, docs/orders-architecture.md seção 6); se o volume por
  // tenant crescer para dezenas de milhares de pedidos/mês, isso vira
  // candidato a agregação no banco (SUM/GROUP BY) em vez de trazer tudo para
  // a aplicação somar. dataMode ausente = 'REAL' — é o que garante que o DRE
  // nunca mistura pedido de demonstração com dado real "automaticamente".
  findAllForPeriod(tenantId: string, dateFrom?: Date, dateTo?: Date, dataMode?: AppDataMode): Promise<Order[]>;
  // Audit Mode — limpeza dos pedidos fictícios de um tenant (AuditSeederService).
  // Nunca toca pedido com isDemo=false, mesmo por engano: implementado com
  // WHERE isDemo = true explícito, nunca "todos menos os reais".
  deleteDemoOrders(tenantId: string): Promise<number>;
  // Sprint 27 (Pick & Pack) — itens de um conjunto ESPECÍFICO de orderIds,
  // numa única query (nunca N+1, mesmo racional de findAllForPeriod). Usado
  // por OrdersService.findItemsForOrders (OrderFinancialsReader).
  findItemsByOrderIds(tenantId: string, orderIds: string[]): Promise<{ orderId: string; skuCode: string | null; quantity: number }[]>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
