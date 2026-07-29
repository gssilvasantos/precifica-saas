import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
// Import direto do runtime, não de `Prisma.PrismaClientKnownRequestError`
// (typeof Prisma) — este projeto roda em sandboxes onde `prisma generate`
// às vezes não executa (rede bloqueada), e nesse cenário o client gerado
// (`@prisma/client/index.d.ts`) fica com um stub incompleto que não
// reexporta `PrismaClientKnownRequestError` no namespace `Prisma`. A classe
// de erro em si vive em `@prisma/client/runtime/library`, que é parte do
// pacote publicado (não do output do `generate`), então este import
// funciona mesmo sem o client ter sido gerado nesta máquina.
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import { SUPPLIER_REPOSITORY, SupplierRepository } from './ports/supplier-repository.port';
import { TAX_PROFILE_REPOSITORY, TaxProfileRepository } from './ports/tax-profile-repository.port';
import { PACKAGING_REPOSITORY, PackagingRepository } from './ports/packaging-repository.port';
import { PRODUCT_CATEGORY_REPOSITORY, ProductCategoryRepository } from './ports/product-category-repository.port';
import { SHIPPING_WEIGHT_CALCULATOR } from '../../../shared/contracts/tokens';
import { ShippingWeightCalculator } from '../../../shared/contracts/shipping-weight-calculator.port';
import { assertMarginsAreConsistent, InconsistentMarginError } from '../domain/margin-rules';
import { assertEditableFields, LockedFieldEditError } from '../domain/product-ownership-rules';
import { resolveShippingDimensions } from '../domain/shipping-dimensions-resolver';
import { diffGovernanceFields, ProductAuditSource } from '../domain/product-audit';
import {
  canSetParent,
  isValidVariantAttributes,
  isValidAttributeDefinitions,
  generateVariantCombinations,
  buildVariantSkuCode,
  buildVariantName,
  VariantAttributeDefinition,
} from '../domain/product-variant';
import { Packaging } from '../domain/packaging.entity';
import { Product } from '../domain/product.entity';
import { ProductAuditLogService } from './product-audit-log.service';

export interface CreateProductInput {
  skuCode: string;
  name: string;
  internalCategory?: string;
  // Árvore de categoria (Fase 4, benchmark Tiny ERP) — ver domain/product.entity.ts.
  // Aceita `null` explícito para desvincular (mesmo racional de mapPrice/ncm/gtin).
  categoryId?: string | null;
  supplierId?: string;
  taxProfileId?: string;
  packagingId?: string;
  // Controle de Lote/Validade (Projeto Estruturante 2, benchmark Bling ERP,
  // 29/07/2026) — ver domain/product.entity.ts, campo controlaLote.
  controlaLote?: boolean;
  // Produto Pai + Variação (Fase 2, benchmark Tiny ERP,
  // docs/tiny-erp-benchmark-analysis.md, seção 2.3) — ver domain/product-variant.ts.
  parentProductId?: string | null;
  variantAttributes?: Record<string, string> | null;
  costPrice: number;
  desiredMarginPct: number;
  minimumMarginPct: number;
  autoRepricingEnabled?: boolean;
  // Política de Preço Mínimo (MAP) — ver domain/product-audit.ts e
  // prisma/schema.prisma (model Product). undefined/null = sem restrição.
  mapPrice?: number | null;
  weightKg: number;
  packagingWeightKg?: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  // Campos fiscais (benchmark Tiny ERP, docs/tiny-erp-benchmark-analysis.md,
  // seções 1.1/2.1) — opcionais, pré-requisito para NF-e (Fase 3) e
  // publicação de anúncio em marketplace (Fase 4).
  ncm?: string | null;
  gtin?: string | null;
  fiscalOriginCode?: number | null;
  // CEST (benchmark Bling, docs/bling-erp-benchmark-analysis.md, seção 2) —
  // obrigatório na NF-e de item sujeito a Substituição Tributária. null é
  // válido (nem todo produto tem ST).
  cest?: string | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

// Quem está fazendo a mudança — obrigatório em update() porque toda
// alteração de campo de governança (mapPrice) precisa de um autor
// identificável na trilha de auditoria (ProductAuditLogService). source
// default 'MANUAL' cobre o caminho de sempre (PATCH /products/:id);
// BulkMapPriceImportService passa 'BULK_IMPORT' explicitamente — MESMO
// método, MESMO hook de auditoria, só a origem muda.
export interface ProductUpdateActor {
  userId: string;
  source?: ProductAuditSource;
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(SUPPLIER_REPOSITORY) private readonly suppliers: SupplierRepository,
    @Inject(TAX_PROFILE_REPOSITORY) private readonly taxProfiles: TaxProfileRepository,
    @Inject(PACKAGING_REPOSITORY) private readonly packagings: PackagingRepository,
    @Inject(PRODUCT_CATEGORY_REPOSITORY) private readonly categories: ProductCategoryRepository,
    @Inject(SHIPPING_WEIGHT_CALCULATOR) private readonly shippingWeight: ShippingWeightCalculator,
    private readonly auditLog: ProductAuditLogService,
  ) {}

  async create(tenantId: string, input: CreateProductInput) {
    this.assertMargins(input.desiredMarginPct, input.minimumMarginPct);
    await this.assertReferencesBelongToTenant(tenantId, input.supplierId, input.taxProfileId);
    await this.assertCategoryBelongsToTenant(tenantId, input.categoryId);
    const packaging = await this.resolvePackaging(tenantId, input.packagingId);

    if (input.parentProductId) {
      // Criação: productId '' nunca colide com um id real (o produto ainda
      // não existe) — a checagem de auto-referência do gate passa trivial,
      // e "já tem filhos" é sempre false (produto novo). Resta validar que
      // o pai existe, pertence ao tenant, não é ele mesmo uma variação, e
      // que a grade de atributos foi informada.
      await this.assertValidParentAssignment(tenantId, '', input.parentProductId, input.variantAttributes, null);
    }

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
        categoryId: input.categoryId ?? null,
        supplierId: input.supplierId,
        taxProfileId: input.taxProfileId,
        packagingId: input.packagingId,
        controlaLote: input.controlaLote,
        parentProductId: input.parentProductId ?? null,
        variantAttributes: input.variantAttributes ?? null,
        costPrice: input.costPrice,
        desiredMarginPct: input.desiredMarginPct,
        minimumMarginPct: input.minimumMarginPct,
        autoRepricingEnabled: input.autoRepricingEnabled,
        mapPrice: input.mapPrice ?? null,
        weightKg: input.weightKg,
        packagingWeightKg: input.packagingWeightKg ?? 0,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        packedWeightKg: weights.packedWeightKg,
        cubicWeightKg: weights.cubicWeightKg,
        shippingWeightKg: weights.shippingWeightKg,
        ncm: input.ncm ?? null,
        gtin: input.gtin ?? null,
        fiscalOriginCode: input.fiscalOriginCode ?? null,
        cest: input.cest ?? null,
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

  async update(tenantId: string, id: string, input: UpdateProductInput, actor: ProductUpdateActor) {
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
    if (input.categoryId !== undefined) {
      await this.assertCategoryBelongsToTenant(tenantId, input.categoryId);
    }

    // Produto Pai + Variação — só roda o gate quando parentProductId está
    // sendo de fato SETADO (string). undefined = não está sendo tocado;
    // null explícito = "desvincular do pai", sempre permitido sem gate (uma
    // variação virar produto normal de novo nunca quebra a hierarquia de
    // ninguém).
    if (input.parentProductId) {
      await this.assertValidParentAssignment(tenantId, id, input.parentProductId, input.variantAttributes, current.variantAttributes);
    }

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

    // Diff de campos de GOVERNANÇA (hoje só mapPrice) calculado ANTES do
    // update — compara o valor ATUAL persistido contra o input recebido.
    // Feito antes, não depois, para nunca gravar um "oldValue" que já
    // reflete o próprio update (a comparação precisa ser sempre
    // antes-vs-depois, não depois-vs-depois).
    const auditEntries = diffGovernanceFields(current, input);

    let updated;
    try {
      updated = await this.products.update(id, {
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

    // Auditoria só é gravada DEPOIS que o update persistiu com sucesso —
    // nunca queremos um registro de auditoria "órfão" descrevendo uma
    // mudança que na verdade falhou (ex.: violação de unique constraint).
    if (auditEntries.length > 0) {
      await this.auditLog.record(tenantId, auditEntries, { userId: actor.userId, source: actor.source ?? 'MANUAL' });
    }

    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.products.deactivate(id);
  }

  // Produto Pai + Variação — grade de variações de um pai (tela de
  // cadastro mostra "Camiseta Azul P / Camiseta Azul M / ..." juntas).
  // Confirma que o produto existe no tenant antes de listar (mesmo erro
  // 404 de findOne para um id inexistente/de outro tenant).
  async findVariants(tenantId: string, id: string): Promise<Product[]> {
    await this.findOne(tenantId, id);
    return this.products.findChildren(tenantId, id);
  }

  // Geração automática de combinações de variação (Quick Win 5, benchmark
  // Bling, docs/bling-erp-benchmark-analysis.md, seção 1.5 — espelha
  // `POST /produtos/variacoes/atributos/gerar-combinacoes`). Dado o produto
  // pai + uma grade de atributos (ex.: Cor:[Azul,Verde], Tamanho:[P,M,G]),
  // cria uma variação para cada combinação, herdando do pai tudo que não é
  // a própria grade (custo, margens, dimensões, dados fiscais) — o lojista
  // ajusta o que precisar depois via PATCH em cada variação individual.
  // Reaproveita create() ponto a ponto: cada variação passa pelo MESMO gate
  // canSetParent/isValidVariantAttributes que uma criação manual passaria,
  // nenhuma lógica de hierarquia duplicada aqui.
  async generateVariantCombinations(
    tenantId: string,
    parentId: string,
    attributes: VariantAttributeDefinition[],
  ): Promise<Product[]> {
    if (!isValidAttributeDefinitions(attributes)) {
      throw new BadRequestException(
        'Informe ao menos um atributo com nome e ao menos uma opção cada (ex.: [{"name":"Cor","options":["Azul","Verde"]}]).',
      );
    }

    const parent = await this.findOne(tenantId, parentId);
    if (parent.parentProductId !== null) {
      throw new BadRequestException(
        'Só é possível gerar combinações de variação a partir de um produto pai (que não seja, ele mesmo, uma variação).',
      );
    }

    const combinations = generateVariantCombinations(attributes);

    // Duas combinações diferentes nunca deveriam colidir no mesmo skuCode —
    // se colidirem (ex.: mesma opção repetida com grafia diferente que
    // normaliza igual, tipo "P" e "p"), é erro de cadastro do próprio
    // lojista na grade informada, melhor recusar tudo de uma vez do que
    // criar uma leva parcial e deixar a duplicata estourar no meio do loop.
    const skuCodes = combinations.map((combo) => buildVariantSkuCode(parent.skuCode, combo, attributes));
    if (new Set(skuCodes).size !== skuCodes.length) {
      throw new BadRequestException(
        'A grade de atributos gera SKUs duplicados para variações diferentes — revise as opções informadas.',
      );
    }

    // Sequencial, não em lote atômico: cada variação é um produto
    // independente (diferente de AccountsPayable.createMany, onde as
    // parcelas do MESMO parcelamento precisam nascer juntas). Se uma
    // combinação falhar no meio (ex.: SKU já usado por outro produto do
    // tenant), as anteriores já criadas permanecem — limitação MVP
    // consciente, documentada em docs/product-variants-architecture.md.
    const created: Product[] = [];
    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      const skuCode = skuCodes[i];
      const name = buildVariantName(parent.name, combo, attributes);
      created.push(
        await this.create(tenantId, {
          skuCode,
          name,
          internalCategory: parent.internalCategory ?? undefined,
          categoryId: parent.categoryId,
          supplierId: parent.supplierId ?? undefined,
          taxProfileId: parent.taxProfileId ?? undefined,
          packagingId: parent.packagingId ?? undefined,
          parentProductId: parent.id,
          variantAttributes: combo,
          costPrice: parent.costPrice,
          desiredMarginPct: parent.desiredMarginPct,
          minimumMarginPct: parent.minimumMarginPct,
          autoRepricingEnabled: parent.autoRepricingEnabled,
          mapPrice: parent.mapPrice,
          weightKg: parent.weightKg,
          packagingWeightKg: parent.packagingWeightKg,
          lengthCm: parent.lengthCm,
          widthCm: parent.widthCm,
          heightCm: parent.heightCm,
          ncm: parent.ncm,
          gtin: parent.gtin,
          fiscalOriginCode: parent.fiscalOriginCode,
          cest: parent.cest,
        }),
      );
    }
    return created;
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

  // categoryId aceita `null` explícito (desvincular) — só valida quando de
  // fato é uma string (mesmo racional de mapPrice/parentProductId: undefined
  // nunca chega aqui, filtrado pelo `!== undefined` no chamador de update()).
  private async assertCategoryBelongsToTenant(tenantId: string, categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    const category = await this.categories.findById(tenantId, categoryId);
    if (!category) throw new BadRequestException('Categoria inválida para esta conta.');
  }

  // Diferente de assertReferencesBelongToTenant (só valida) — aqui
  // precisamos da ENTIDADE de volta, para alimentar resolveShippingDimensions.
  private async resolvePackaging(tenantId: string, packagingId: string | null | undefined): Promise<Packaging | null> {
    if (!packagingId) return null;
    const packaging = await this.packagings.findById(tenantId, packagingId);
    if (!packaging) throw new BadRequestException('Embalagem inválida para esta conta.');
    return packaging;
  }

  // Produto Pai + Variação — monta o contexto (pai candidato + se o próprio
  // produto já tem filhos) e delega a decisão para o gate puro canSetParent.
  // productId '' (usado por create(), onde o produto ainda não tem id) faz
  // a checagem de auto-referência e de filhos existentes passar trivial —
  // ver comentário nos dois pontos de chamada.
  private async assertValidParentAssignment(
    tenantId: string,
    productId: string,
    candidateParentId: string,
    variantAttributesInput: Record<string, string> | null | undefined,
    fallbackAttributes: Record<string, string> | null,
  ): Promise<void> {
    const candidateParent = await this.products.findById(tenantId, candidateParentId);
    const children = productId ? await this.products.findChildren(tenantId, productId) : [];

    const check = canSetParent({
      productId: productId || '(novo produto)',
      candidateParentId,
      candidateParent,
      productHasChildren: children.length > 0,
    });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }

    const effectiveAttributes = variantAttributesInput !== undefined ? variantAttributesInput : fallbackAttributes;
    if (!isValidVariantAttributes(effectiveAttributes)) {
      throw new BadRequestException(
        'variantAttributes é obrigatório e precisa de ao menos um par chave/valor não vazio quando o produto é uma variação (ex.: {"Cor": "Azul", "Tamanho": "P"}).',
      );
    }
  }

  private translateError(error: unknown) {
    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
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
