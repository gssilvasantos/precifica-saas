import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PACKAGING_USAGE_EVENT_REPOSITORY, PackagingUsageEventRepository } from './ports/packaging-usage-event-repository.port';
import { PACKAGING_REPOSITORY, PackagingRepository } from './ports/packaging-repository.port';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';

export interface RecordPackagingUsageInput {
  productId: string;
  packagingId: string;
  quantity?: number;
}

// Write-only por desenho — ver "HONESTIDADE TÉCNICA" em
// prisma/schema.prisma acima de `model PackagingUsageEvent` e em
// docs/pricing-intelligence-architecture.md, seção 9: não existe hoje um
// módulo de Vendas/Pedidos que chame `record` automaticamente. Este serviço
// é o mecanismo (endpoint manual) que um futuro módulo de Vendas vai chamar
// no mesmo lugar em que confirma uma venda — nada aqui precisa mudar quando
// isso acontecer.
@Injectable()
export class PackagingUsageEventsService {
  constructor(
    @Inject(PACKAGING_USAGE_EVENT_REPOSITORY) private readonly events: PackagingUsageEventRepository,
    @Inject(PACKAGING_REPOSITORY) private readonly packagings: PackagingRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
  ) {}

  async record(tenantId: string, input: RecordPackagingUsageInput) {
    const product = await this.products.findById(tenantId, input.productId);
    if (!product) throw new BadRequestException('Produto inválido para esta conta.');

    const packaging = await this.packagings.findById(tenantId, input.packagingId);
    if (!packaging) throw new BadRequestException('Embalagem inválida para esta conta.');

    // unitCostPrice é congelado AGORA, do custo atual da embalagem — não é
    // uma referência viva. Se o fornecedor reajustar o preço amanhã, este
    // evento já registrado continua contando o custo de quando a "venda"
    // aconteceu, que é o que o DRE de um período passado precisa.
    return this.events.record({
      tenantId,
      productId: input.productId,
      packagingId: input.packagingId,
      quantity: input.quantity ?? 1,
      unitCostPrice: packaging.costPrice,
    });
  }

  findByProduct(tenantId: string, productId: string) {
    return this.events.findByProduct(tenantId, productId);
  }
}
