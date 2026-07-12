import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../../shared/contracts/tokens';
import { ShippingWeightCalculator } from '../../../shared/contracts/shipping-weight-calculator.port';
import {
  ProductCatalogWriteData,
  ProductCatalogWriter,
} from '../../../shared/contracts/product-catalog-writer.port';
import { CatalogSettingsService } from './catalog-settings.service';

// Implementação da porta ProductCatalogWriter (shared/contracts/) — a
// direção inversa do ShippingWeightCalculator: aqui o Catalog EXPÕE uma
// porta para outro módulo consumir. Só o erp-integration deve injetar isto
// (via token PRODUCT_CATALOG_WRITER); nunca é chamado pelos controllers
// HTTP do Catalog. Ver docs/erp-integration-architecture.md, seção 3.
@Injectable()
export class CatalogSyncWriterService implements ProductCatalogWriter {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(SHIPPING_WEIGHT_CALCULATOR) private readonly shippingWeight: ShippingWeightCalculator,
    private readonly catalogSettings: CatalogSettingsService,
  ) {}

  async upsertFromExternalSource(data: ProductCatalogWriteData): Promise<{ productId: string; changed: boolean }> {
    const existing = await this.products.findByExternalId(data.tenantId, data.sourceSystem, data.externalId);

    // Recalcula peso cubado/frete a cada sync — o ERP é a fonte da verdade
    // para dimensões, então qualquer mudança física precisa refletir aqui,
    // exatamente como no fluxo manual (ProductsService.update).
    const weights = await this.shippingWeight.calculate(data.tenantId, {
      weightKg: data.weightKg,
      packagingWeightKg: data.packagingWeightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
    });

    if (!existing) {
      // Produto nunca visto antes deste externalId: cria com margem padrão
      // do tenant (CatalogSettings — 20%/8% se nunca configurado) porque o
      // Olist não tem esse conceito. Editável depois, a qualquer momento.
      const defaults = await this.catalogSettings.getDefaultMargins(data.tenantId);
      const created = await this.products.create({
        tenantId: data.tenantId,
        skuCode: data.skuCode,
        name: data.name,
        costPrice: data.costPrice,
        desiredMarginPct: defaults.desiredMarginPct,
        minimumMarginPct: defaults.minimumMarginPct,
        weightKg: data.weightKg,
        packagingWeightKg: data.packagingWeightKg,
        lengthCm: data.lengthCm,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        packedWeightKg: weights.packedWeightKg,
        cubicWeightKg: weights.cubicWeightKg,
        shippingWeightKg: weights.shippingWeightKg,
        stockQuantity: data.stockQuantity,
        erpSalePrice: data.erpSalePrice ?? undefined,
        photoUrls: data.photoUrls,
        sourceSystem: data.sourceSystem,
        externalId: data.externalId,
        lastSyncedAt: new Date(),
      });
      return { productId: created.id, changed: true };
    }

    // Produto já existe: atualiza só os campos espelhados. Margem, perfil
    // fiscal, categoria interna e fornecedor NUNCA são tocados aqui — são
    // configuração do tenant, preservada entre syncs.
    // Simplificação consciente: não atualiza skuCode mesmo que renomeado no
    // Olist (o vínculo de identidade é por externalId, não por SKU — o
    // produto certo continua sendo atualizado; renomear o SKU aqui fica
    // para uma etapa futura, se necessário).
    const updated = await this.products.update(existing.id, {
      name: data.name,
      costPrice: data.costPrice,
      weightKg: data.weightKg,
      packagingWeightKg: data.packagingWeightKg,
      lengthCm: data.lengthCm,
      widthCm: data.widthCm,
      heightCm: data.heightCm,
      packedWeightKg: weights.packedWeightKg,
      cubicWeightKg: weights.cubicWeightKg,
      shippingWeightKg: weights.shippingWeightKg,
      stockQuantity: data.stockQuantity,
      erpSalePrice: data.erpSalePrice,
      photoUrls: data.photoUrls,
      lastSyncedAt: new Date(),
    });
    return { productId: updated.id, changed: true };
  }
}
