import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FetchContext,
  OrderCapableProvider,
  ProviderCapability,
  ProviderHealthStatus,
  RawOrderCandidate,
  RawOrderItemCandidate,
} from '../../../../shared/contracts/marketplace-provider.contract';
import { NuvemshopApiClient } from './nuvemshop-api.client';
import { NuvemshopConnectionService } from '../../application/nuvemshop-connection.service';
import {
  NUVEMSHOP_CONNECTION_REPOSITORY,
  NuvemshopConnectionRepository,
} from '../../application/ports/nuvemshop-connection-repository.port';
import { mapNuvemshopStatus } from './nuvemshop-order-status.mapper';

// Mesmo esqueleto de NuvemshopFeeRuleProvider: provider POR TENANT (cada
// loja tem seus próprios pedidos), credenciais via NuvemshopConnectionService
// (nunca decriptadas aqui diretamente), paginação delegada ao client.
@Injectable()
export class NuvemshopOrderProvider implements OrderCapableProvider {
  readonly code = 'NUVEMSHOP_ORDERS';
  readonly marketplaceCode = 'NUVEMSHOP';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.ORDERS];

  private readonly logger = new Logger(NuvemshopOrderProvider.name);

  constructor(
    private readonly client: NuvemshopApiClient,
    private readonly connection: NuvemshopConnectionService,
    @Inject(NUVEMSHOP_CONNECTION_REPOSITORY) private readonly connections: NuvemshopConnectionRepository,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — ver fetchOrders
  }

  async listTenantIdsToSync(): Promise<string[]> {
    const active = await this.connections.findAllActive();
    return active.map((c) => c.tenantId);
  }

  async fetchOrders(ctx: FetchContext): Promise<RawOrderCandidate[]> {
    if (!ctx.tenantId) {
      this.logger.warn('NuvemshopOrderProvider chamado sem tenantId — pedido é sempre por loja, não há candidato global.');
      return [];
    }

    const credentials = await this.connection.getDecryptedCredentials(ctx.tenantId);
    if (!credentials) {
      this.logger.warn(`Tenant ${ctx.tenantId} não tem conexão ativa com a Nuvemshop — pulando sync de pedidos.`);
      return [];
    }

    let rawOrders: unknown[];
    try {
      rawOrders = await this.client.fetchOrders(credentials.storeId, credentials.accessToken, ctx.since);
    } catch (error) {
      this.logger.error(`Falha ao buscar pedidos da Nuvemshop (tenant ${ctx.tenantId}): ${(error as Error).message}`);
      throw error;
    }

    const candidates: RawOrderCandidate[] = [];
    for (const raw of rawOrders) {
      const normalized = this.tryNormalize(raw);
      if (!normalized) continue;
      candidates.push(normalized);
    }
    return candidates;
  }

  private tryNormalize(raw: unknown): RawOrderCandidate | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;

    const externalOrderId = String(obj.id ?? '');
    if (!externalOrderId) return null;

    const rawItems = Array.isArray(obj.products) ? (obj.products as Record<string, unknown>[]) : [];
    const items: RawOrderItemCandidate[] = rawItems
      .map((item) => this.tryNormalizeItem(item))
      .filter((item): item is RawOrderItemCandidate => item !== null);

    const rawStatus = String(obj.status ?? 'open');
    const paymentStatus = obj.payment_status ? String(obj.payment_status) : undefined;
    const shippingStatus = obj.shipping_status ? String(obj.shipping_status) : undefined;
    const unifiedStatus = mapNuvemshopStatus({ status: rawStatus, paymentStatus, shippingStatus });

    const externalStatusParts = [rawStatus, paymentStatus, shippingStatus].filter(Boolean);
    const totalAmount = Number(obj.total ?? 0);

    return {
      externalOrderId,
      status: unifiedStatus,
      externalStatus: externalStatusParts.join('/'),
      subtotalAmount: Number(obj.subtotal ?? obj.total ?? 0),
      shippingAmount: Number(obj.shipping_cost_customer ?? 0),
      discountAmount: Number(obj.discount ?? 0),
      totalAmount,
      // Normalização financeira (Etapa 17): Nuvemshop é a loja PRÓPRIA do
      // vendedor, não um marketplace de terceiros — não há comissão de
      // marketplace a deduzir do pedido (feeAmount honestamente 0, não uma
      // omissão). A única dedução real na Nuvemshop é a taxa do GATEWAY de
      // pagamento (parcelas x janela de recebimento), que já é tratada por
      // um mecanismo agregado separado (NuvemshopFeeRuleProvider, usado no
      // cálculo de Floor Price) — não é uma dedução por pedido individual, e
      // por isso não entra aqui. Ver docs/orders-architecture.md, seção 11.
      feeAmount: 0,
      netAmount: totalAmount,
      currency: String(obj.currency ?? 'BRL'),
      // fiscalResponsibility/buyerTaxId/invoiceNumber omitidos de propósito:
      // a Nuvemshop não retorna esses dados no payload padrão de pedido, e o
      // vendedor SEMPRE é quem emite a nota fiscal na loja própria
      // (fiscalResponsibility default SELLER, aplicado pelo repositório).
      orderedAt: obj.created_at ? new Date(String(obj.created_at)) : new Date(),
      paidAt: obj.paid_at ? new Date(String(obj.paid_at)) : undefined,
      shippedAt: obj.shipped_at ? new Date(String(obj.shipped_at)) : undefined,
      cancelledAt: obj.cancelled_at ? new Date(String(obj.cancelled_at)) : undefined,
      items,
      rawPayload: raw,
    };
  }

  private tryNormalizeItem(item: Record<string, unknown>): RawOrderItemCandidate | null {
    const externalSku = item.sku ? String(item.sku) : item.product_id ? String(item.product_id) : null;
    if (!externalSku) return null;

    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.price ?? 0);
    return {
      externalSku,
      productName: String(item.name ?? ''),
      quantity,
      unitPrice,
      totalPrice: unitPrice * quantity,
    };
  }
}
