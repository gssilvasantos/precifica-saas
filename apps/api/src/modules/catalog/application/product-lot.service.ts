import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { PRODUCT_LOT_REPOSITORY, ProductLotRepository } from './ports/product-lot-repository.port';
import { ProductLotReader, LotMetadata } from '../../../shared/contracts/product-lot-reader.port';
import { ProductLot, ProductLotCreateData, ProductLotStatus, isValidLotData } from '../domain/product-lot';

export interface CreateProductLotInput {
  lotCode: string;
  dataFabricacao?: Date | null;
  dataValidade: Date;
  diasPermitidoVenda?: number;
  codigoAgregacao?: string | null;
}

// Produtos-Lotes (Projeto Estruturante 2, benchmark Bling ERP, 29/07/2026,
// ver docs/product-lots-architecture.md). Opera por skuCode (não productId)
// internamente — mesmo racional de ProductStructureService: quem consome
// esta porta de fora (logistics-fulfillment) só conhece SKUs, nunca a PK
// interna do catálogo. O controller (que recebe :id de Product na URL)
// resolve id -> skuCode antes de chamar este service.
@Injectable()
export class ProductLotService implements ProductLotReader {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PRODUCT_LOT_REPOSITORY) private readonly lots: ProductLotRepository,
  ) {}

  async create(tenantId: string, productId: string, input: CreateProductLotInput): Promise<ProductLot> {
    const product = await this.requireProduct(tenantId, productId);
    if (!product.controlaLote) {
      throw new BadRequestException(
        'Este produto não está marcado como controlaLote=true — marque controlaLote=true antes de cadastrar lotes.',
      );
    }

    const data: ProductLotCreateData = {
      tenantId,
      skuCode: product.skuCode,
      lotCode: input.lotCode,
      dataFabricacao: input.dataFabricacao ?? null,
      dataValidade: input.dataValidade,
      diasPermitidoVenda: input.diasPermitidoVenda ?? 0,
      codigoAgregacao: input.codigoAgregacao ?? null,
    };
    const check = isValidLotData(data);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const existing = await this.lots.findOne(tenantId, product.skuCode, input.lotCode);
    if (existing) {
      throw new BadRequestException(`Já existe um lote com código "${input.lotCode}" para este produto.`);
    }

    return this.lots.create(data);
  }

  async listByProductId(tenantId: string, productId: string): Promise<ProductLot[]> {
    const product = await this.requireProduct(tenantId, productId);
    return this.lots.findByTenantAndSku(tenantId, product.skuCode);
  }

  async updateStatus(tenantId: string, productId: string, lotCode: string, status: ProductLotStatus): Promise<ProductLot> {
    const product = await this.requireProduct(tenantId, productId);
    const lot = await this.lots.findOne(tenantId, product.skuCode, lotCode);
    if (!lot) {
      throw new NotFoundException(`Lote "${lotCode}" não encontrado para este produto.`);
    }
    return this.lots.updateStatus(lot.id, status);
  }

  // ProductLotReader (shared/contracts) — consumida pelo logistics-fulfillment
  // (LotAvailabilityService) sem depender de PRODUCT_LOT_REPOSITORY nem
  // desta classe concreta.
  async getLots(tenantId: string, skuCode: string): Promise<LotMetadata[]> {
    const lots = await this.lots.findByTenantAndSku(tenantId, skuCode);
    return lots.map(toMetadata);
  }

  async findLot(tenantId: string, skuCode: string, lotCode: string): Promise<LotMetadata | null> {
    const lot = await this.lots.findOne(tenantId, skuCode, lotCode);
    return lot ? toMetadata(lot) : null;
  }

  private async requireProduct(tenantId: string, productId: string) {
    const product = await this.products.findById(tenantId, productId);
    if (!product) {
      throw new NotFoundException(`Produto ${productId} não encontrado.`);
    }
    return product;
  }
}

function toMetadata(lot: ProductLot): LotMetadata {
  return { lotCode: lot.lotCode, dataValidade: lot.dataValidade, diasPermitidoVenda: lot.diasPermitidoVenda, status: lot.status };
}
