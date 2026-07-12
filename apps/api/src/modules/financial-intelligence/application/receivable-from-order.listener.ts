import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ORDER_EVENTS, OrderCancelledEvent, OrderPaidEvent } from '../../orders/domain/order-events';
import {
  RECEIVABLE_RECORD_REPOSITORY,
  ReceivableRecordRepository,
} from './ports/receivable-record-repository.port';

// Integração Orders -> Financial Intelligence — mesmo padrão de
// CompetitorSignalListener/PackagingCostChangeListener: importa SÓ o arquivo
// de constantes/tipos do módulo de origem (orders/domain/order-events.ts),
// zero import de OrdersModule ou de qualquer classe de aplicação/infra de
// lá. Reagir a um evento nunca exige import de módulo (ver
// docs/platform-architecture.md, seção 3).
//
// Idempotência: a chave de match (tenantId, marketplaceSource,
// externalReference) é a MESMA chave natural usada por
// ReceivableReconciliationService — reaproveitada aqui, não um conceito
// novo. `channelCode` do pedido vira `marketplaceSource`, e
// `externalOrderId` vira `externalReference`, exatamente como documentado
// em docs/orders-architecture.md, seção 5.
@Injectable()
export class ReceivableFromOrderListener {
  private readonly logger = new Logger(ReceivableFromOrderListener.name);

  constructor(
    @Inject(RECEIVABLE_RECORD_REPOSITORY) private readonly receivables: ReceivableRecordRepository,
  ) {}

  @OnEvent(ORDER_EVENTS.PAID)
  async handleOrderPaid(payload: OrderPaidEvent): Promise<void> {
    try {
      const existing = await this.receivables.findByExternalReference(
        payload.tenantId,
        payload.channelCode,
        payload.externalOrderId,
      );
      if (existing) {
        // Reimportar o mesmo pedido sem mudança de status não deve criar uma
        // segunda linha — mesma idempotência de evento já usada no restante
        // da plataforma (ver ORDER_EVENTS, orders/domain/order-events.ts).
        this.logger.log(
          `Pedido ${payload.externalOrderId} (${payload.channelCode}, tenant ${payload.tenantId}) já tem ` +
            `ReceivableRecord — nenhuma linha nova criada.`,
        );
        return;
      }

      // expectedDate é uma ESTIMATIVA nesta primeira fatia: a data real do
      // repasse só é conhecida quando o relatório de liquidação do
      // marketplace chega (ver ReceivableReconciliationService, que marca
      // PAID com a data real). Usar paidAt como estimativa inicial é honesto
      // e simples — não inventa uma janela de recebimento por marketplace
      // que ninguém configurou ainda.
      // Etapa 17 — usa netAmount (o que o vendedor de fato recebe, já
      // líquido da comissão do canal), não totalAmount (o que o cliente
      // pagou). O adapter de cada canal é quem calcula essa diferença — este
      // listener nunca sabe (nem precisa saber) qual é a estrutura de
      // comissão da Nuvemshop, Mercado Livre, Shopee etc. Ver
      // docs/orders-architecture.md, seção 11.
      await this.receivables.create({
        tenantId: payload.tenantId,
        amount: payload.netAmount,
        expectedDate: payload.paidAt,
        marketplaceSource: payload.channelCode,
        externalReference: payload.externalOrderId,
      });
      this.logger.log(
        `ReceivableRecord criado para o pedido ${payload.externalOrderId} (${payload.channelCode}, tenant ${payload.tenantId}), valor líquido ${payload.netAmount} (bruto ${payload.totalAmount}).`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao criar ReceivableRecord para o pedido ${payload.externalOrderId} (tenant ${payload.tenantId}): ${(error as Error).message}`,
      );
    }
  }

  @OnEvent(ORDER_EVENTS.CANCELLED)
  async handleOrderCancelled(payload: OrderCancelledEvent): Promise<void> {
    try {
      const existing = await this.receivables.findByExternalReference(
        payload.tenantId,
        payload.channelCode,
        payload.externalOrderId,
      );
      if (!existing) return; // pedido nunca chegou a ser pago — nada a cancelar

      if (existing.status === 'PAID') {
        // Repasse já reconciliado (dinheiro já confirmado na conta) — cancelar
        // silenciosamente apagaria evidência de um valor já recebido. Isso é
        // um cenário de ESTORNO, que exige um fluxo próprio (fora do escopo
        // desta fatia) — só loga um alerta para o operador tratar manualmente.
        this.logger.warn(
          `Pedido ${payload.externalOrderId} (tenant ${payload.tenantId}) foi cancelado, mas seu ReceivableRecord já ` +
            `está PAID — possível estorno. Ação manual necessária (não cancelado automaticamente).`,
        );
        return;
      }

      if (existing.status === 'CANCELLED') return; // idempotência de evento

      await this.receivables.cancel(existing.id);
      this.logger.log(
        `ReceivableRecord do pedido ${payload.externalOrderId} (tenant ${payload.tenantId}) cancelado — pedido de origem foi cancelado.`,
      );
    } catch (error) {
      this.logger.error(
        `Falha ao cancelar ReceivableRecord do pedido ${payload.externalOrderId} (tenant ${payload.tenantId}): ${(error as Error).message}`,
      );
    }
  }
}
