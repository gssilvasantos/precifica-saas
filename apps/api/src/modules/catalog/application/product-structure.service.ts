import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import {
  PRODUCT_STRUCTURE_REPOSITORY,
  ProductStructureComponent,
  ProductStructureRepository,
} from './ports/product-structure-repository.port';
import { ProductStructureReader, ProductStructureComponentLine } from '../../../shared/contracts/product-structure-reader.port';
import { isValidComponents, ProductStructureComponentInput } from '../domain/product-structure';

// BOM real — Produtos-Estrutura (Projeto Estruturante 1, benchmark Bling ERP,
// 29/07/2026, ver docs/production-architecture.md). Opera por skuCode (não
// productId) internamente — mesmo racional de StockLedgerEntry/
// PurchaseOrderItem: quem consome esta porta de fora (production) só conhece
// SKUs, nunca a PK interna do catálogo. O controller (que recebe :id de
// Product na URL, mesmo padrão de generateVariantCombinations) resolve
// id -> skuCode antes de chamar este service.
@Injectable()
export class ProductStructureService implements ProductStructureReader {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_STRUCTURE_REPOSITORY) private readonly structures: ProductStructureRepository,
  ) {}

  async getByProductId(tenantId: string, parentProductId: string): Promise<ProductStructureComponent[]> {
    const parent = await this.requireParent(tenantId, parentProductId);
    return this.structures.findByParentSku(tenantId, parent.skuCode);
  }

  async setComponents(
    tenantId: string,
    parentProductId: string,
    components: ProductStructureComponentInput[],
  ): Promise<ProductStructureComponent[]> {
    const parent = await this.requireParent(tenantId, parentProductId);

    if (!parent.isKit) {
      throw new BadRequestException(
        'Este produto não está marcado como kit (isKit=false) — marque isKit=true antes de cadastrar a estrutura de componentes.',
      );
    }
    if (!isValidComponents(parent.skuCode, components)) {
      throw new BadRequestException(
        'Informe ao menos um componente com componentSkuCode e quantity positiva, sem duplicados nem o próprio produto como componente.',
      );
    }

    return this.structures.replaceAll(
      tenantId,
      parent.skuCode,
      components.map((c) => ({ componentSkuCode: c.componentSkuCode, quantity: c.quantity })),
    );
  }

  // ProductStructureReader (shared/contracts) — consumida pelo módulo
  // production sem depender de PRODUCT_STRUCTURE_REPOSITORY nem desta classe
  // concreta.
  async getComponents(tenantId: string, parentSkuCode: string): Promise<ProductStructureComponentLine[]> {
    const components = await this.structures.findByParentSku(tenantId, parentSkuCode);
    return components.map((c) => ({ componentSkuCode: c.componentSkuCode, quantity: c.quantity }));
  }

  private async requireParent(tenantId: string, parentProductId: string) {
    const parent = await this.products.findById(tenantId, parentProductId);
    if (!parent) {
      throw new NotFoundException(`Produto ${parentProductId} não encontrado.`);
    }
    return parent;
  }
}
