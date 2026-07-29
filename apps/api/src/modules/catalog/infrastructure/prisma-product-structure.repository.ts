import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ProductStructureComponentUpsertData,
  ProductStructureRepository,
} from '../application/ports/product-structure-repository.port';
import { ProductStructureComponent } from '../application/ports/product-structure-repository.port';

@Injectable()
export class PrismaProductStructureRepository implements ProductStructureRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByParentSku(tenantId: string, parentSkuCode: string): Promise<ProductStructureComponent[]> {
    const records = await this.prisma.productStructureComponent.findMany({
      where: { tenantId, parentSkuCode },
      orderBy: { componentSkuCode: 'asc' },
    });
    return records.map((r) => this.toDomain(r));
  }

  // Apaga tudo e recria — semântica de PUT idempotente (ver comentário no
  // port). Dentro de uma transação para nunca deixar a estrutura pela
  // metade se a criação falhar no meio.
  async replaceAll(
    tenantId: string,
    parentSkuCode: string,
    components: ProductStructureComponentUpsertData[],
  ): Promise<ProductStructureComponent[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.productStructureComponent.deleteMany({ where: { tenantId, parentSkuCode } });
      await tx.productStructureComponent.createMany({
        data: components.map((c) => ({
          tenantId,
          parentSkuCode,
          componentSkuCode: c.componentSkuCode,
          quantity: c.quantity,
        })),
      });
      const created = await tx.productStructureComponent.findMany({
        where: { tenantId, parentSkuCode },
        orderBy: { componentSkuCode: 'asc' },
      });
      return created.map((r) => this.toDomain(r));
    });
  }

  private toDomain(record: Record<string, unknown> & { quantity: { toString(): string } }): ProductStructureComponent {
    return {
      ...record,
      quantity: Number(record.quantity),
    } as ProductStructureComponent;
  }
}
