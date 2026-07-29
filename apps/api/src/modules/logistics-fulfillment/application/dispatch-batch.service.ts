import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DISPATCH_BATCH_REPOSITORY, DispatchBatchRepository } from './ports/dispatch-batch-repository.port';
import { DISPATCH_BATCH_ORDER_REPOSITORY, DispatchBatchOrderRepository } from './ports/dispatch-batch-order-repository.port';
import { STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY, StockMovementAuditEventRepository } from './ports/stock-movement-audit-event-repository.port';
import { ORDER_FISCAL_READER, OrderFiscalReader } from '../../../shared/contracts/order-fiscal-reader.port';
import { isShippingLabelCapable, OrderCapableProvider, ShippingLabelCapableProvider } from '../../../shared/contracts/marketplace-provider.contract';
import { OrderProviderRegistry } from '../../orders/application/order-provider-registry.service';
import { FreightProviderRegistry } from '../../freight-shipping/application/freight-provider-registry.service';
import { FreightRecipientAddress } from '../../freight-shipping/application/freight-label-provider.contract';
import {
  canAddOrderToBatch,
  canCancelBatch,
  canConcludeBatch,
  canGenerateLabelForOrder,
  canIncludeInDispatchBatch,
  DispatchBatch,
  DispatchBatchOrder,
  resolveLabelStrategy,
} from '../domain/dispatch-batch.entity';

export interface GenerateLabelManualInput {
  // Só exigido quando resolveLabelStrategy devolve GENERIC_FREIGHT — ver
  // AVISO DE HONESTIDADE em freight-label-provider.contract.ts: nenhum
  // canal hoje entrega endereço estruturado do destinatário, então quem
  // aciona a etiqueta precisa informar manualmente.
  packageWeightKg: number;
  declaredValue?: number;
  recipientAddress: FreightRecipientAddress;
  // Quick Win 6 (benchmark Bling) — ver comentário em FreightLabelInput
  // (freight-label-provider.contract.ts) para o racional de cada campo.
  avisoRecebimento?: boolean;
  maoPropria?: boolean;
}

// Expedição em lote (Fase 5, benchmark Tiny ERP, 29/07/2026) — orquestra o
// agrupamento de pedidos JÁ CONFERIDOS pelo Pick & Pack (gate
// canIncludeInDispatchBatch) e a geração de etiqueta, nativa do marketplace
// (ShippingLabelCapableProvider, via OrderProviderRegistry) ou de
// transportadora avulsa (FreightLabelProvider, via FreightProviderRegistry) —
// nunca decide sozinho qual API chamar: resolveLabelStrategy (domínio puro)
// é o único lugar que traduz `formaEnvio` nessa escolha. Ver
// docs/dispatch-batch-architecture.md.
@Injectable()
export class DispatchBatchService {
  constructor(
    @Inject(DISPATCH_BATCH_REPOSITORY) private readonly batches: DispatchBatchRepository,
    @Inject(DISPATCH_BATCH_ORDER_REPOSITORY) private readonly batchOrders: DispatchBatchOrderRepository,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly auditEvents: StockMovementAuditEventRepository,
    @Inject(ORDER_FISCAL_READER) private readonly orderReader: OrderFiscalReader,
    private readonly orderProviders: OrderProviderRegistry,
    private readonly freightProviders: FreightProviderRegistry,
  ) {}

  async createBatch(tenantId: string, formaEnvio: string, requestedByUserId?: string, notes?: string): Promise<DispatchBatch> {
    if (!formaEnvio.trim()) {
      throw new BadRequestException('formaEnvio é obrigatório.');
    }
    return this.batches.create({ tenantId, formaEnvio: formaEnvio.trim().toUpperCase(), requestedByUserId, notes });
  }

  async findOne(tenantId: string, id: string): Promise<{ batch: DispatchBatch; orders: DispatchBatchOrder[] }> {
    const batch = await this.requireBatch(tenantId, id);
    const orders = await this.batchOrders.findAllByBatch(tenantId, id);
    return { batch, orders };
  }

  async listForTenant(tenantId: string): Promise<DispatchBatch[]> {
    return this.batches.findAllByTenant(tenantId);
  }

  // Gate de elegibilidade central (ver docs/dispatch-batch-architecture.md):
  // só entra no lote um pedido cujo Pick & Pack (StockMovementAuditEvent
  // RETAIL_SHIPMENT) já esteja APROVADO — nunca antes disso. Preserva a
  // auditoria por pedido como pré-requisito, não como algo substituído pelo
  // lote.
  async addOrder(tenantId: string, dispatchBatchId: string, orderId: string): Promise<DispatchBatchOrder> {
    const batch = await this.requireBatch(tenantId, dispatchBatchId);

    const existingActiveLink = await this.batchOrders.findActiveByOrder(tenantId, orderId);
    const addGate = canAddOrderToBatch(batch, existingActiveLink);
    if (!addGate.ok) {
      throw new BadRequestException(addGate.reason);
    }

    const auditEvent = await this.auditEvents.findByOrderId(tenantId, orderId, 'RETAIL_SHIPMENT');
    const eligibilityGate = canIncludeInDispatchBatch(auditEvent);
    if (!eligibilityGate.ok) {
      throw new BadRequestException(eligibilityGate.reason);
    }

    return this.batchOrders.add(tenantId, dispatchBatchId, orderId);
  }

  async removeOrder(tenantId: string, dispatchBatchId: string, batchOrderId: string): Promise<void> {
    const batch = await this.requireBatch(tenantId, dispatchBatchId);
    if (batch.status !== 'ABERTO') {
      throw new BadRequestException(`Lote já está ${batch.status} — não é possível remover pedidos.`);
    }
    await this.batchOrders.remove(tenantId, batchOrderId);
  }

  // Gera a etiqueta de UM pedido do lote — nunca lança em falha do
  // provider (nativo ou avulso), sempre grava markError com a mensagem;
  // permite que o operador tente novamente sem perder o resto do lote.
  async generateLabel(
    tenantId: string,
    dispatchBatchId: string,
    batchOrderId: string,
    manualInput?: GenerateLabelManualInput,
  ): Promise<DispatchBatchOrder> {
    const batch = await this.requireBatch(tenantId, dispatchBatchId);
    const link = await this.batchOrders.findById(tenantId, batchOrderId);
    if (!link || link.dispatchBatchId !== dispatchBatchId) {
      throw new NotFoundException('Pedido não encontrado neste lote.');
    }
    const gate = canGenerateLabelForOrder(link);
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }

    const resolution = resolveLabelStrategy(batch.formaEnvio);
    if (resolution.strategy === 'NONE') {
      throw new BadRequestException(`Forma de envio "${batch.formaEnvio}" não gera etiqueta automática — conclua o lote diretamente.`);
    }

    const order = await this.orderReader.getForFiscalEmission(tenantId, link.orderId);
    if (!order) {
      return this.batchOrders.markError(link.id, 'Pedido não encontrado — pode ter sido removido.');
    }

    if (resolution.strategy === 'NATIVE_MARKETPLACE') {
      if (order.channelCode !== resolution.requiredChannelCode) {
        return this.batchOrders.markError(
          link.id,
          `Forma de envio "${batch.formaEnvio}" exige pedido do canal ${resolution.requiredChannelCode}, mas este pedido é do canal ${order.channelCode}.`,
        );
      }
      // findByMarketplaceCode devolve OrderCapableProvider[], não
      // MarketplaceProvider[] — o type guard isShippingLabelCapable sozinho
      // não estreita o retorno de .find() para ShippingLabelCapableProvider
      // porque ShippingLabelCapableProvider não é um subtipo de
      // OrderCapableProvider (são duas capacidades irmãs, ambas extends
      // MarketplaceProvider). O predicate abaixo devolve a interseção dos
      // dois, que É um subtipo de OrderCapableProvider — só assim o
      // TypeScript aceita a assinatura de type guard do .find().
      const provider = this.orderProviders
        .findByMarketplaceCode(order.channelCode)
        .find((p): p is OrderCapableProvider & ShippingLabelCapableProvider => isShippingLabelCapable(p));
      if (!provider) {
        return this.batchOrders.markError(link.id, `Nenhum provider com capacidade de etiqueta nativa registrado para ${order.channelCode}.`);
      }
      const result = await provider.getShippingLabel({ marketplaceCode: order.channelCode, tenantId }, order.externalOrderId);
      if (!result.success) {
        return this.batchOrders.markError(link.id, result.message ?? 'Falha ao buscar etiqueta nativa do canal.');
      }
      return this.batchOrders.markLabeled(link.id, { trackingCode: result.trackingCode, labelUrl: result.labelUrl });
    }

    // GENERIC_FREIGHT
    if (!manualInput) {
      return this.batchOrders.markError(
        link.id,
        'Forma de envio via transportadora avulsa exige peso do pacote e endereço do destinatário informados manualmente.',
      );
    }
    const provider = this.freightProviders.findByProviderCode(resolution.freightProviderCode!);
    if (!provider) {
      return this.batchOrders.markError(link.id, `Nenhuma conexão configurada para ${resolution.freightProviderCode}.`);
    }
    const result = await provider.generateLabel(tenantId, {
      recipientAddress: manualInput.recipientAddress,
      packageWeightKg: manualInput.packageWeightKg,
      declaredValue: manualInput.declaredValue,
      avisoRecebimento: manualInput.avisoRecebimento,
      maoPropria: manualInput.maoPropria,
      orderReference: order.externalOrderId,
    });
    if (!result.success) {
      return this.batchOrders.markError(link.id, result.message ?? `Falha ao gerar etiqueta via ${resolution.freightProviderCode}.`);
    }
    return this.batchOrders.markLabeled(link.id, { trackingCode: result.trackingCode, labelUrl: result.labelUrl });
  }

  async concludeBatch(tenantId: string, dispatchBatchId: string): Promise<DispatchBatch> {
    const batch = await this.requireBatch(tenantId, dispatchBatchId);
    const orders = await this.batchOrders.findAllByBatch(tenantId, dispatchBatchId);
    const gate = canConcludeBatch(batch, orders);
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }
    return this.batches.updateStatus(dispatchBatchId, 'DESPACHADO', new Date());
  }

  async cancelBatch(tenantId: string, dispatchBatchId: string): Promise<DispatchBatch> {
    const batch = await this.requireBatch(tenantId, dispatchBatchId);
    const gate = canCancelBatch(batch);
    if (!gate.ok) {
      throw new BadRequestException(gate.reason);
    }
    return this.batches.updateStatus(dispatchBatchId, 'CANCELADO');
  }

  private async requireBatch(tenantId: string, id: string): Promise<DispatchBatch> {
    const batch = await this.batches.findById(tenantId, id);
    if (!batch) {
      throw new NotFoundException(`Lote de expedição ${id} não encontrado.`);
    }
    return batch;
  }
}
