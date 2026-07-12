import { Inject, Injectable, Logger } from '@nestjs/common';
import { LogisticsCostReader } from '../../../shared/contracts/logistics-cost-reader.port';
import { PRODUCT_CATALOG_READER, PACKAGING_COST_READER } from '../../../shared/contracts/tokens';
import { ProductCatalogReader } from '../../../shared/contracts/product-catalog-reader.port';
import { PackagingCostReader } from '../../../shared/contracts/packaging-cost-reader.port';
import { WarehouseService } from './warehouse.service';

// Implementação de LogisticsCostReader (Sprint 26) — o "custo logístico
// real (Full vs. Físico) de cada SKU" que o Motor de Margem de Promoções
// precisa. Composto de DUAS fontes, cada uma com dono próprio, nunca
// duplicadas aqui:
//   1. Custo de embalagem — hierarquia de resolução (kit/GROUPING -> vínculo
//      individual -> SAFETY_DEFAULT), via PACKAGING_COST_READER + PRODUCT_CATALOG_READER.
//   2. Custo operacional do depósito — Warehouse.logisticsCostPerUnit (Full
//      do canal), via WarehouseService.
//
// Prioridade 2 da hierarquia (agrupamento dinâmico por cubagem, vários SKUs
// no mesmo despacho) só se aplica a um PEDIDO real — getPackagingCostForOrder
// existe para isso, mas NENHUM consumidor desta sprint (PromotionIntelligenceService
// avalia 1 SKU isolado, antes de qualquer pedido existir) o chama ainda.
// Ver docs/promotion-intelligence-architecture.md.
@Injectable()
export class LogisticsCostReaderService implements LogisticsCostReader {
  private readonly logger = new Logger(LogisticsCostReaderService.name);

  constructor(
    @Inject(PRODUCT_CATALOG_READER) private readonly catalog: ProductCatalogReader,
    @Inject(PACKAGING_COST_READER) private readonly packagingCosts: PackagingCostReader,
    private readonly warehouses: WarehouseService,
  ) {}

  async getTotalLogisticsCost(tenantId: string, skuCode: string, channelCode: string): Promise<number> {
    const [packagingCost, fullWarehouse] = await Promise.all([
      this.getPackagingCost(tenantId, skuCode),
      this.warehouses.ensureFullWarehouse(tenantId, channelCode),
    ]);
    return packagingCost + fullWarehouse.logisticsCostPerUnit;
  }

  // Hierarquia de resolução de custo de embalagem por SKU (Prioridades 1/3
  // — a 2 não se aplica a um SKU isolado, ver comentário da classe):
  //   1. Kit: se o SKU é um kit (Product.isKit), packagingId aponta para a
  //      Embalagem de Agrupamento — usa o custo dela.
  //   2. Vínculo individual normal: Product.packagingCostPrice já resolvido
  //      pelo catálogo (findBySku).
  //   3. Default de segurança: nenhuma embalagem resolvida — usa a
  //      SAFETY_DEFAULT do tenant (conservador, nunca assume zero em
  //      silêncio); se o tenant também não tem uma cadastrada, loga e
  //      assume 0 (não há mais nada a fazer sem exigir cadastro).
  private async getPackagingCost(tenantId: string, skuCode: string): Promise<number> {
    const product = await this.catalog.findBySku(tenantId, skuCode);
    if (!product) return 0; // SKU inexistente é validado em outra camada (quem chama já barra antes)

    if (product.isKit && product.packagingId) {
      const grouping = await this.packagingCosts.findById(tenantId, product.packagingId);
      if (grouping) return grouping.costPrice;
    }

    if (product.packagingCostPrice != null) {
      return product.packagingCostPrice;
    }

    const safetyDefault = await this.packagingCosts.findSafetyDefault(tenantId);
    if (safetyDefault) return safetyDefault.costPrice;

    this.logger.warn(
      `SKU ${skuCode} (tenant ${tenantId}) sem embalagem vinculada e sem Embalagem de Segurança cadastrada — custo de embalagem assumido como 0.`,
    );
    return 0;
  }

  // Prioridade 2 da hierarquia — agrupamento dinâmico por cubagem total do
  // pedido, escolhendo a menor Embalagem Master que comporte o total em vez
  // de somar embalagem individual por item (o que infla artificialmente o
  // custo). Pronto para o CMV de Orders/DRE consumir; sem consumidor nesta
  // sprint.
  async getPackagingCostForOrder(tenantId: string, items: { skuCode: string; quantity: number }[]): Promise<number> {
    const masters = await this.packagingCosts.findAllMaster(tenantId);
    if (masters.length === 0) {
      const safetyDefault = await this.packagingCosts.findSafetyDefault(tenantId);
      return safetyDefault?.costPrice ?? 0;
    }

    // Nota: a soma de peso/volume real dos itens depende de dimensões do
    // Product (resolveShippingDimensions, módulo catalog) — deliberadamente
    // fora do escopo desta sprint (nenhum consumidor chama este método
    // ainda). Por ora, escolhe a Embalagem Master de menor capacidade
    // cadastrada como aproximação conservadora até o consumidor real
    // (CMV de pedidos) definir o cálculo de cubagem total.
    void items;
    return masters[0].costPrice;
  }
}
