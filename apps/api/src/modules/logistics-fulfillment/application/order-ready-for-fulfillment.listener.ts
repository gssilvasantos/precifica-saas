import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderReadyForFulfillmentEvent } from '../../orders/domain/order-events';
import { ALERT_SERVICE, AlertService } from '../../../shared/observability/ports/alert-service.port';
import { StockMovementAuditEventService } from './stock-movement-audit-event.service';
import { WarehouseService } from './warehouse.service';
import {
  STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY,
  StockMovementAuditEventRepository,
} from './ports/stock-movement-audit-event-repository.port';

// Integração Orders -> Logistics Fulfillment — mesmo padrão de
// ReceivableFromOrderListener (financial-intelligence): importa SÓ o
// arquivo de constantes/tipos do módulo de origem
// (orders/domain/order-events.ts), zero import de OrdersModule ou de
// qualquer classe de aplicação/infra de lá.
//
// Este é o gancho real pedido pelo usuário: ORDER_EVENTS.READY_FOR_FULFILLMENT
// já existia desde a Etapa 16/17, documentado como "ponto de extensão...
// nenhum consumidor existe ainda" — este listener é o primeiro consumidor.
// Ele só cria o evento de auditoria PENDENTE (fase 1 do gate) — o pedido
// permanece bloqueado para o Ledger até a conferência visual acontecer.
@Injectable()
export class OrderReadyForFulfillmentListener {
  private readonly logger = new Logger(OrderReadyForFulfillmentListener.name);

  constructor(
    private readonly auditEvents: StockMovementAuditEventService,
    private readonly warehouses: WarehouseService,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly eventsRepo: StockMovementAuditEventRepository,
    @Inject(ALERT_SERVICE) private readonly alerts: AlertService,
  ) {}

  @OnEvent(ORDER_EVENTS.READY_FOR_FULFILLMENT)
  async handle(payload: OrderReadyForFulfillmentEvent): Promise<void> {
    try {
      const existing = await this.eventsRepo.findByOrderId(payload.tenantId, payload.orderId, 'RETAIL_SHIPMENT');
      if (existing) {
        // Reimportar o mesmo pedido sem uma nova transição de status não
        // deve criar um segundo evento de auditoria — mesma idempotência de
        // evento já usada no restante da plataforma.
        this.logger.log(
          `Pedido ${payload.externalOrderId} (tenant ${payload.tenantId}) já tem evento de auditoria de despacho — nenhum novo criado.`,
        );
        return;
      }

      const physical = await this.warehouses.ensurePhysicalWarehouse(payload.tenantId);

      await this.auditEvents.createPending({
        tenantId: payload.tenantId,
        eventType: 'RETAIL_SHIPMENT',
        sourceWarehouseId: physical.id,
        orderIds: [payload.orderId],
      });

      this.logger.log(
        `Evento de auditoria (RETAIL_SHIPMENT) criado para o pedido ${payload.externalOrderId} (${payload.channelCode}, tenant ${payload.tenantId}) — aguardando conferência visual antes do despacho.`,
      );
    } catch (error) {
      const message = `Falha ao criar evento de auditoria de despacho para o pedido ${payload.externalOrderId} (tenant ${payload.tenantId}): ${(error as Error).message}`;
      this.logger.error(message);
      this.alerts.emitAlert({
        source: 'OrderReadyForFulfillmentListener',
        severity: 'ERROR',
        message: `Falha ao criar evento de auditoria de despacho para o pedido ${payload.externalOrderId}`,
        context: { tenantId: payload.tenantId, orderId: payload.orderId, channelCode: payload.channelCode, error: (error as Error).message },
      });
    }
  }
}
