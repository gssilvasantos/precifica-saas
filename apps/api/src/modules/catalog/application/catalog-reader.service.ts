import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { PACKAGING_REPOSITORY, PackagingRepository } from './ports/packaging-repository.port';
import { ProductCatalogReader, ProductCatalogSummary } from '../../../shared/contracts/product-catalog-reader.port';
import { PackagingLinkedProductsReader } from '../../../shared/contracts/packaging-linked-products-reader.port';

// Implementação da porta de leitura ProductCatalogReader — usa o mesmo
// ProductRepository interno do Catalog, mas só expõe os campos que um
// consumidor externo (Pricing Intelligence) realmente precisa, nunca o
// Product completo. Evita vazar a forma interna da entidade.
//
// custoEfetivo (Packaging Intel): quando o produto tem packagingId, o custo
// que o Pricing Engine deve usar é costPrice + Packaging.costPrice, não só
// costPrice — RESPOSTA à pergunta "como garantir que o estrategista saiba
// que o custo subiu se eu trocar a embalagem": ele não precisa "saber" nada
// mudou. `findBySku` busca o produto E a embalagem vinculada (SEM cache)
// toda vez que é chamado — se você troca Product.packagingId ou o
// Packaging.costPrice, a PRÓXIMA chamada a PricingDecisionService.decide()
// já lê o par (produto, embalagem) atual do banco e devolve o custo certo.
// Nenhuma camada entre o banco e o PricingStrategist guarda o custo em
// memória (diferente, de propósito, do FinancialPolicyReaderService, cujo
// cache de 5 min é aceitável porque política fiscal muda raramente — custo
// de aquisição é lido a cada decisão e NUNCA pode estar desatualizado).
@Injectable()
export class CatalogReaderService implements ProductCatalogReader, PackagingLinkedProductsReader {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PACKAGING_REPOSITORY) private readonly packagings: PackagingRepository,
  ) {}

  async findBySku(tenantId: string, skuCode: string): Promise<ProductCatalogSummary | null> {
    // findAllActive + filtro em memória por ora — não há um findBySku dedicado
    // no ProductRepository (a busca pública sempre foi por id). Simples o
    // bastante para o volume atual; vira índice dedicado se o simulador virar
    // um endpoint de alto tráfego.
    const products = await this.products.findAllActive(tenantId);
    const product = products.find((p) => p.skuCode === skuCode);
    if (!product) return null;

    const packaging = product.packagingId ? await this.packagings.findById(tenantId, product.packagingId) : null;
    const packagingCostPrice = packaging?.costPrice ?? null;

    return {
      productId: product.id,
      skuCode: product.skuCode,
      name: product.name,
      costPrice: product.costPrice + (packagingCostPrice ?? 0),
      productCostPrice: product.costPrice,
      packagingCostPrice,
      desiredMarginPct: product.desiredMarginPct,
      minimumMarginPct: product.minimumMarginPct,
      autoRepricingEnabled: product.autoRepricingEnabled,
      packagingId: product.packagingId,
      isKit: product.isKit,
      mapPrice: product.mapPrice,
    };
  }

  // Implementação de PackagingLinkedProductsReader — consumida pelo
  // PackagingCostChangeListener (Pricing Intelligence) para saber quais SKUs
  // recalcular quando Packaging.costPrice muda. Mesmo filtro em memória de
  // findBySku acima; mesmo aviso de performance (findAllActive completo).
  async findSkuCodesByPackaging(tenantId: string, packagingId: string): Promise<string[]> {
    const products = await this.products.findAllActive(tenantId);
    return products.filter((p) => p.packagingId === packagingId).map((p) => p.skuCode);
  }
}
