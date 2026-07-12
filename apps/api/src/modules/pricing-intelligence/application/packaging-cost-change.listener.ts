import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PACKAGING_EVENTS, PackagingCostChangedEvent } from '../../catalog/domain/packaging-events';
import { PACKAGING_LINKED_PRODUCTS_READER } from '../../../shared/contracts/tokens';
import { PackagingLinkedProductsReader } from '../../../shared/contracts/packaging-linked-products-reader.port';
import { PricingDecisionService } from './pricing-decision.service';

// Reprecificação REATIVA a mudança de custo de embalagem — resposta de
// código à pergunta "como o PricingDecisionService deve ser chamado para
// recalcular o Floor Price sempre que o custo da embalagem mudar".
//
// Repare que isto NÃO é o que garante que o custo esteja correto (isso já é
// garantido por construção — ver comentário em CatalogReaderService.findBySku,
// seção 9 de docs/pricing-intelligence-architecture.md: o custo é lido fresco
// do banco em toda chamada, nunca cacheado). Este listener existe por um
// motivo diferente: PROATIVIDADE. Sem ele, um SKU com autoRepricingEnabled
// = true só teria o preço realmente reaplicado no marketplace no próximo
// sinal de concorrência (BUY_BOX_LOST) ou clique manual em "Aplicar Preço
// Agora" — o cálculo estaria certo se alguém pedisse, mas ninguém pediria
// até lá. Ao reagir a PACKAGING_EVENTS.COST_CHANGED, o preço já sai
// reaplicado no mesmo instante em que a embalagem é reprecificada.
//
// Mesma disciplina de desacoplamento do CompetitorSignalListener: importa só
// o arquivo de eventos do Catalog (puro dado, sem I/O), não o
// CatalogModule/CatalogReaderService diretamente — quem traz o
// CatalogModule para dentro do grafo de DI é o pricing-intelligence.module.ts
// (necessário de qualquer forma, por causa de PRODUCT_CATALOG_READER/
// FINANCIAL_POLICY_READER), não este listener.
@Injectable()
export class PackagingCostChangeListener {
  private readonly logger = new Logger(PackagingCostChangeListener.name);

  constructor(
    @Inject(PACKAGING_LINKED_PRODUCTS_READER) private readonly linkedProducts: PackagingLinkedProductsReader,
    private readonly pricingDecisions: PricingDecisionService,
  ) {}

  @OnEvent(PACKAGING_EVENTS.COST_CHANGED)
  async handleCostChanged(payload: PackagingCostChangedEvent): Promise<void> {
    const skuCodes = await this.linkedProducts.findSkuCodesByPackaging(payload.tenantId, payload.packagingId);
    if (skuCodes.length === 0) {
      this.logger.log(
        `Embalagem ${payload.packagingId} (tenant ${payload.tenantId}) mudou de custo (${payload.previousCostPrice} -> ${payload.newCostPrice}), mas nenhum produto está vinculado a ela — nada a reprecificar.`,
      );
      return;
    }

    this.logger.log(
      `Embalagem ${payload.packagingId} (tenant ${payload.tenantId}) mudou de custo (${payload.previousCostPrice} -> ${payload.newCostPrice}) — reprecificando ${skuCodes.length} SKU(s) vinculado(s).`,
    );

    for (const skuCode of skuCodes) {
      try {
        const result = await this.pricingDecisions.decideAndMaybeApply(payload.tenantId, skuCode);
        if (!result) {
          this.logger.warn(`SKU ${skuCode}: sem dado suficiente para recalcular decisão após mudança de custo de embalagem.`);
          continue;
        }
        this.logger.log(
          `SKU ${skuCode}: ${result.decision.action} -> ${result.decision.recommendedPrice} ` +
            `${result.applied ? '[APLICADO]' : '[NÃO APLICADO]'} ${result.reason}`,
        );
      } catch (error) {
        this.logger.error(`Falha ao reprecificar SKU ${skuCode} após mudança de custo de embalagem: ${(error as Error).message}`);
      }
    }
  }
}
