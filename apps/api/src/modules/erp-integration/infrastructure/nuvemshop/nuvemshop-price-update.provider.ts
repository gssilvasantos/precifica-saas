import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FetchContext,
  PriceUpdateCapableProvider,
  PriceUpdateResult,
  ProviderCapability,
  ProviderHealthStatus,
} from '../../../../shared/contracts/marketplace-provider.contract';
import { NuvemshopApiClient } from './nuvemshop-api.client';
import { NuvemshopConnectionService } from '../../application/nuvemshop-connection.service';
import {
  NUVEMSHOP_CONNECTION_REPOSITORY,
  NuvemshopConnectionRepository,
} from '../../application/ports/nuvemshop-connection-repository.port';

// Push de preço para a Nuvemshop (31/07/2026) — mesmo esqueleto de
// NuvemshopFeeRuleProvider/NuvemshopOrderProvider (client + connection +
// repo por tenant), mas para a capacidade PRICE_UPDATE do Pricing Engine
// (PriceUpdateDispatcherService, shared/contracts/price-update-dispatcher.port.ts).
//
// AVISO DE HONESTIDADE: `updatePrice` recebe (ctx, externalId, newPrice) —
// contrato compartilhado por TODOS os canais, sem skuCode (ver
// PriceUpdateCapableProvider). Para a Nuvemshop, `externalId` é o
// product.id (ver NuvemshopChannelListingSyncService — ChannelListing não
// guarda o variantId), e o preço é POR VARIANTE. Quando o produto tem
// exatamente 1 variante, não há ambiguidade e a chamada é 100% segura.
// Quando o produto tem 2+ variantes (grade de cor/tamanho, por exemplo),
// este provider não tem como saber qual delas corresponde ao SKU que
// disparou a decisão de preço — em vez de arriscar atualizar a variante
// errada, ele recusa a chamada com uma mensagem clara. Resolver isso de
// verdade exigiria estender PriceUpdateCommand/PriceUpdateCapableProvider
// com skuCode (mudança de contrato compartilhado por todos os canais, fora
// do escopo desta task) — documentado aqui para a próxima iteração.
@Injectable()
export class NuvemshopPriceUpdateProvider implements PriceUpdateCapableProvider {
  readonly code = 'NUVEMSHOP_PRICE_UPDATE';
  readonly marketplaceCode = 'NUVEMSHOP';
  readonly sourceType = 'OFFICIAL_API' as const;
  readonly capabilities = [ProviderCapability.PRICE_UPDATE];

  private readonly logger = new Logger(NuvemshopPriceUpdateProvider.name);

  constructor(
    private readonly client: NuvemshopApiClient,
    private readonly connection: NuvemshopConnectionService,
    @Inject(NUVEMSHOP_CONNECTION_REPOSITORY) private readonly connections: NuvemshopConnectionRepository,
  ) {}

  async healthCheck(): Promise<ProviderHealthStatus> {
    return { status: 'UP' }; // saúde real é por tenant — ver updatePrice
  }

  async listTenantIdsToSync(): Promise<string[]> {
    const active = await this.connections.findAllActive();
    return active.map((c) => c.tenantId);
  }

  async updatePrice(ctx: FetchContext, externalId: string, newPrice: number): Promise<PriceUpdateResult> {
    if (!ctx.tenantId) {
      const message = 'NuvemshopPriceUpdateProvider chamado sem tenantId — preço é sempre por loja, não há alvo global.';
      this.logger.warn(message);
      return { success: false, externalId, message };
    }

    const credentials = await this.connection.getDecryptedCredentials(ctx.tenantId);
    if (!credentials) {
      const message = `Tenant ${ctx.tenantId} não tem conexão ativa com a Nuvemshop.`;
      this.logger.warn(message);
      return { success: false, externalId, message };
    }

    let product;
    try {
      product = await this.client.fetchProduct(credentials.storeId, credentials.accessToken, externalId);
    } catch (error) {
      const message = `Falha ao buscar produto ${externalId} na Nuvemshop: ${(error as Error).message}`;
      this.logger.error(message);
      return { success: false, externalId, message };
    }

    if (!product) {
      return { success: false, externalId, message: `Produto ${externalId} não encontrado na Nuvemshop (pode ter sido removido/despublicado).` };
    }
    if (product.variants.length === 0) {
      return { success: false, externalId, message: `Produto ${externalId} não tem nenhuma variante com SKU na Nuvemshop.` };
    }
    if (product.variants.length > 1) {
      // Ver AVISO DE HONESTIDADE no comentário da classe.
      return {
        success: false,
        externalId,
        message: `Produto ${externalId} tem ${product.variants.length} variantes na Nuvemshop — atualização automática de preço só é suportada para produtos com 1 variante (ambiguidade de SKU). Atualize manualmente pelo painel da loja.`,
      };
    }

    const variant = product.variants[0];
    if (!variant.id) {
      return { success: false, externalId, message: `Variante do produto ${externalId} sem id retornado pela Nuvemshop — não é possível atualizar.` };
    }

    try {
      await this.client.updateVariantPrice(credentials.storeId, credentials.accessToken, externalId, variant.id, newPrice);
      return { success: true, externalId, appliedPrice: newPrice };
    } catch (error) {
      const message = `Falha ao atualizar preço na Nuvemshop (produto ${externalId}, variante ${variant.id}): ${(error as Error).message}`;
      this.logger.error(message);
      return { success: false, externalId, message };
    }
  }
}
