import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../../shared/contracts/tokens';
import { ShippingWeightCalculator } from '../../../shared/contracts/shipping-weight-calculator.port';
import {
  ProductCatalogWriteData,
  ProductCatalogWriter,
} from '../../../shared/contracts/product-catalog-writer.port';
import { CatalogSettingsService } from './catalog-settings.service';

// Devolve `{ campo: valor }` só quando o Kyneti ainda não tem nada e o ERP
// trouxe algo. Nos demais casos devolve `{}` — e como o objeto é espalhado no
// payload do update, a chave nem chega ao Prisma, que é o que garante que um
// valor já existente não seja tocado.
//
// Objeto em vez de `??` direto porque `existing ?? novo` gravaria o valor
// atual de volta a cada sync: funcionaria, mas escreveria sempre, e o diff de
// atualização deixaria de dizer a verdade sobre o que mudou.
function preencherSeVazio<T>(campo: string, atual: T | null, doErp: T | null): Record<string, T> {
  if (atual !== null && atual !== undefined) return {};
  if (doErp === null || doErp === undefined) return {};
  return { [campo]: doErp };
}

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

    // Traduz o externalId do PAI para o id interno. O sync só conhece
    // identificadores do ERP; a tradução mora aqui, do lado do dono da tabela.
    //
    // Pai ausente NÃO impede a importação: a variação do Olist é um produto
    // completo (tem custo, estoque, peso e dimensões próprios), então ela
    // entra sozinha em vez de ser descartada por causa do pai. Perde-se o
    // agrupamento, não o produto — degradação preferível ao silêncio.
    const parentProductId =
      data.parentExternalId != null
        ? ((await this.products.findByExternalId(data.tenantId, data.sourceSystem, data.parentExternalId))?.id ?? null)
        : null;

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
        // Produto novo: o ERP é a única fonte que existe para os campos
        // fiscais, então entram como vieram (inclusive null).
        ncm: data.ncm,
        cest: data.cest,
        gtin: data.gtin,
        fiscalOriginCode: data.fiscalOriginCode,
        parentProductId,
        variantAttributes: data.variantAttributes ?? null,
        internalCategory: data.erpCategoryPath ?? undefined,
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
      // Campos fiscais: o sync PREENCHE LACUNA, nunca sobrescreve.
      //
      // Diferente do bloco acima (nome, custo, peso, dimensões), onde o ERP é
      // dono e o valor dele vence sempre. Aqui não: a classificação fiscal
      // pode ser corrigida no Kyneti — inclusive porque o cadastro do ERP
      // costuma ser o lugar onde o NCM errado nasceu. Sobrescrever a cada sync
      // apagaria a correção silenciosamente, e o usuário só descobriria pelo
      // imposto.
      //
      // Por isso estes campos também NÃO entraram em ERP_OWNED_FIELDS
      // (product-ownership-rules.ts): continuam editáveis na tela, como o
      // comentário do schema.prisma já antecipava que seria revisitado quando
      // o sync passasse a trazê-los.
      ...preencherSeVazio('ncm', existing.ncm, data.ncm),
      ...preencherSeVazio('cest', existing.cest, data.cest),
      ...preencherSeVazio('gtin', existing.gtin, data.gtin),
      ...preencherSeVazio('fiscalOriginCode', existing.fiscalOriginCode, data.fiscalOriginCode),
      // Vínculo com o pai também é preenche-lacuna: se o pai só passou a
      // existir num sync posterior (a ordem de importação não é garantida),
      // a variação órfã é adotada agora. Se já está vinculada, não se mexe.
      ...preencherSeVazio('parentProductId', existing.parentProductId, parentProductId),
      ...preencherSeVazio('variantAttributes', existing.variantAttributes, data.variantAttributes ?? null),
      // Categoria de origem: registra, não impõe. Quem já classificou o
      // produto no Kyneti não tem esse trabalho desfeito.
      ...preencherSeVazio('internalCategory', existing.internalCategory, data.erpCategoryPath ?? null),
    });
    return { productId: updated.id, changed: true };
  }
}
