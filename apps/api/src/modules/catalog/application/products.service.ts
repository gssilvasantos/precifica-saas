import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { SUPPLIER_REPOSITORY, SupplierRepository } from './ports/supplier-repository.port';
import { TAX_PROFILE_REPOSITORY, TaxProfileRepository } from './ports/tax-profile-repository.port';
import { PACKAGING_REPOSITORY, PackagingRepository } from './ports/packaging-repository.port';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../../shared/contracts/tokens';
import { ShippingWeightCalculator } from '../../../shared/contracts/shipping-weight-calculator.port';
import { assertMarginsAreConsistent, InconsistentMarginError } from '../domain/margin-rules';
import { assertEditableFields, LockedFieldEditError } from '../domain/product-ownership-rules';
import { resolveShippingDimensions } from '../domain/shipping-dimensions-resolver';
import { Packaging } from '../domain/packaging.entity';

export interface CreateProductInput {
  skuCode: string;
  name: string;
  internalCategory?: string;
  supplierId?: string;
  taxProfileId?: string;
  packagingId?: string;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  autoRepricingEnabled?: boolean;
  weightKg: number;
  packagingWeightKg?: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export type UpdateProductInput = Partial<CreateProductInput>;

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
    @Inject(TAX_PROFILE_REPOSITORY) private readonly taxProfiles: TaxProfileRepository,
    @Inject(PACKAGING_REPOSITORY) private readonly packagings: PackagingRepository,
    @Inject(SHIPPING_WEIGHT_CALCULATOR) private readonly shippingWeight: ShippingWeightCalculator,
  ) {}

  async create(tenantId: string, input: CreateProductInput) {
    this.assertMargins(input.desiredMarginPct, input.minimumMarginPct);
    await this.assertReferencesBelongToTenant(tenantId, input.supplierId, input.taxProfileId);
    const packaging = await this.resolvePackaging(tenantId, input.packagingId);

    const weights = await this.shippingWeight.calculate(
      tenantId,
      resolveShippingDimensions(
        {
          weightKg: input.weightKg,
          packagingWeightKg: input.packagingWeightKg ?? 0,
          lengthCm: input.lengthCm,
          widthCm: input.widthCm,
          heightCm: input.heightCm,
        },
        toPackagingDimensions(packaging),
      ),
    );

    try {
      return await this.products.create({
        tenantId,
        skuCode: input.skuCode,
        name: input.name,
        internalCategory: input.internalCategory,
        supplierId: input.supplierId,
        taxProfileId: input.taxProfileId,
        packagingId: input.packagingId,
        costPrice: input.costPrice,
        desiredMarginPct: input.desiredMarginPct,
        minimumMarginPct: input.minimumMarginPct,
        autoRepricingEnabled: input.autoRepricingEnabled,
        weightKg: input.weightKg,
        packagingWeightKg: input.packagingWeightKg ?? 0,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        packedWeightKg: weights.packedWeightKg,
        cubicWeightKg: weights.cubicWeightKg,
        shippingWeightKg: weights.shippingWeightKg,
      });
    } catch (error) {
      throw this.translateError(error);
    }
  }

  findAll(tenantId: string) {
    return this.products.findAllActive(tenantId);
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.products.findById(tenantId, id);
    if (!product) throw new NotFoundException('Produto não encontrado.');
    return product;
  }

  async update(tenantId: string, id: string, input: UpdateProductInput) {
    const current = await this.findOne(tenantId, id);

    // Etapa 5 — produto espelhado do Olist: campos físicos/comerciais só
    // mudam no próximo sync do ERP (docs/erp-integration-architecture.md,
    // seção 2). Margem, fornecedor, perfil fiscal e categoria continuam
    // sempre editáveis aqui embaixo.
    try {
      assertEditableFields(current.sourceSystem, input);
    } catch (error) {
      if (error instanceof LockedFieldEditError) throw new BadRequestException(error.message);
      throw error;
    }

    const desiredMarginPct = input.desiredMarginPct ?? current.desiredMarginPct;
    const minimumMarginPct = input.minimumMarginPct ?? current.minimumMarginPct;
    this.assertMargins(desiredMarginPct, minimumMarginPct);
    await this.assertReferencesBelongToTenant(tenantId, input.supplierId, input.taxProfileId);

    // Trocar de embalagem muda as dimensões/peso efetivos mesmo que nenhum
    // campo físico do PRODUTO em si tenha sido tocado neste update — por
    // isso packagingChanged entra na mesma condição de recálculo abaixo.
    const packagingChanged = input.packagingId !== undefined && input.packagingId !== current.packagingId;
    const weightInputsChanged =
      input.weightKg !== undefined ||
      input.packagingWeightKg !== undefined ||
      input.lengthCm !== undefined ||
      input.widthCm !== undefined ||
      input.heightCm !== undefined ||
      packagingChanged;

    let weights;
    if (weightInputsChanged) {
      const effectivePackagingId = input.packagingId !== undefined ? input.packagingId : current.packagingId ?? undefined;
      const packaging = await this.resolvePackaging(tenantId, effectivePackagingId);
      weights = await this.shippingWeight.calculate(
        tenantId,
        resolveShippingDimensions(
          {
            weightKg: input.weightKg ?? current.weightKg,
            packagingWeightKg: input.packagingWeightKg ?? current.packagingWeightKg,
            lengthCm: input.lengthCm ?? current.lengthCm,
            widthCm: input.widthCm ?? current.widthCm,
            heightCm: input.heightCm ?? current.heightCm,
          },
          toPackagingDimensions(packaging),
        ),
      );
    }

    try {
      return await this.products.update(id, {
        ...input,
        ...(weights
          ? {
              packedWeightKg: weights.packedWeightKg,
              cubicWeightKg: weights.cubicWeightKg,
              shippingWeightKg: weights.shippingWeightKg,
            }
          : {}),
      });
    } catch (error) {
      throw this.translateError(error);
    }
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.products.deactivate(id);
  }

  private assertMargins(desiredMarginPct: number, minimumMarginPct: number) {
    try {
      assertMarginsAreConsistent(desiredMarginPct, minimumMarginPct);
    } catch (error) {
      if (error instanceof InconsistentMarginError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async assertReferencesBelongToTenant(tenantId: string, supplierId?: string, taxProfileId?: string) {
    if (supplierId) {
      const supplier = await this.suppliers.findById(tenantId, supplierId);
      if (!supplier) throw new BadRequestException('Fornecedor inválido para esta conta.');
    }
    if (taxProfileId) {
      const taxProfile = await this.taxProfiles.findById(tenantId, taxProfileId);
      if (!taxProfile) throw new BadRequestException('Perfil fiscal inválido para esta conta.');
    }
  }

  // Diferente de assertReferencesBelongToTenant (só valida) — aqui
  // precisamos da ENTIDADE de volta, para alimentar resolveShippingDimensions.
  private async resolvePackaging(tenantId: string, packagingId: string | null | undefined): Promise<Packaging | null> {
    if (!packagingId) return null;
    const packaging = await this.packagings.findById(tenantId, packagingId);
    if (!packaging) throw new BadRequestException('Embalagem inválida para esta conta.');
    return packaging;
  }

  private translateError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe um produto com esse SKU nesta conta.');
    }
    return error;
  }
}

function toPackagingDimensions(packaging: Packaging | null) {
  if (!packaging) return null;
  return {
    weightG: packaging.weightG,
    lengthCm: packaging.lengthCm,
    widthCm: packaging.widthCm,
    heightCm: packaging.heightCm,
  };
}
