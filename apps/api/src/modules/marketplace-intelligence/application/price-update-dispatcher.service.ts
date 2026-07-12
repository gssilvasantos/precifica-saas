import { Injectable, Logger } from '@nestjs/common';
import {
  PriceUpdateCommand,
  PriceUpdateDispatcher,
  PriceUpdateOutcome,
} from '../../../shared/contracts/price-update-dispatcher.port';
import { MarketplaceProviderRegistry } from './marketplace-provider-registry.service';

// Implementação da porta PriceUpdateDispatcher — o único lugar do sistema
// que faz "dado um marketplaceCode, ache o provider certo e chame
// updatePrice()". O Pricing Engine (Pricing Intelligence) só conhece esta
// classe através do token PRICE_UPDATE_DISPATCHER + a interface; nunca
// importa MarketplaceProviderRegistry nem nenhum Provider concreto — é
// exatamente o desacoplamento pedido.
@Injectable()
export class PriceUpdateDispatcherService implements PriceUpdateDispatcher {
  private readonly logger = new Logger(PriceUpdateDispatcherService.name);

  constructor(private readonly registry: MarketplaceProviderRegistry) {}

  async dispatch(command: PriceUpdateCommand): Promise<PriceUpdateOutcome> {
    const provider = this.registry.findPriceUpdateProvider(command.marketplaceCode);

    if (!provider) {
      // Resultado de negócio, não exceção — ver nota no port. Canal sem
      // provider de escrita (ainda) é uma situação esperada hoje (nenhum
      // canal tem OAuth de escrita implementado de verdade), não um bug.
      const message = `Canal ${command.marketplaceCode} não tem um provider com suporte a atualização de preço (ainda).`;
      this.logger.warn(message);
      return { success: false, externalId: command.externalId, message };
    }

    try {
      const result = await provider.updatePrice(
        { marketplaceCode: command.marketplaceCode, tenantId: command.tenantId },
        command.externalId,
        command.newPrice,
      );
      return {
        success: result.success,
        externalId: result.externalId,
        appliedPrice: result.appliedPrice,
        message: result.message,
      };
    } catch (error) {
      this.logger.error(
        `Falha ao atualizar preço no canal ${command.marketplaceCode} (SKU ${command.skuCode}): ${(error as Error).message}`,
      );
      return { success: false, externalId: command.externalId, message: (error as Error).message };
    }
  }
}
