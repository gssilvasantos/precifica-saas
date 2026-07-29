import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRICE_LIST_REPOSITORY, PriceListRepository } from './ports/price-list-repository.port';
import {
  PRICE_LIST_EXCEPTION_REPOSITORY,
  PriceListExceptionRepository,
} from './ports/price-list-exception-repository.port';
import { PRODUCT_REPOSITORY, ProductRepository } from './ports/product-repository.port';
import {
  PriceList,
  PriceListException,
  isValidAdjustmentPct,
  isValidName,
  isValidOverridePrice,
  resolveListPrice,
} from '../domain/price-list.entity';

export interface CreatePriceListInput {
  name: string;
  adjustmentPct: number;
}

export type UpdatePriceListInput = Partial<CreatePriceListInput>;

export interface SetExceptionInput {
  productId: string;
  overridePrice: number;
}

// Lista de Preços (Fase 2, benchmark Tiny ERP,
// docs/tiny-erp-benchmark-analysis.md, seção 1.5) — CRUD de listas +
// exceções, e a leitura que combina os dois (resolvePrice). Nunca lê o
// catálogo de preços do motor de repricing (PricingStrategist) por conta
// própria: basePrice é sempre informado por quem consulta, mesmo racional
// de resolveShippingDimensions receber tudo explicitamente em vez de buscar
// sozinho — ver docs/price-lists-architecture.md.
@Injectable()
export class PriceListService {
  constructor(
    @Inject(PRICE_LIST_REPOSITORY) private readonly priceLists: PriceListRepository,
    @Inject(PRICE_LIST_EXCEPTION_REPOSITORY) private readonly exceptions: PriceListExceptionRepository,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
  ) {}

  // async (não só Promise<>) de propósito: assertName/assertAdjustmentPct
  // lançam de forma síncrona, e sem o método ser async esse throw escapa
  // antes de virar uma Promise rejeitada — quebra qualquer `await
  // expect(...).rejects.toThrow()` no chamador (bug real encontrado nos
  // testes desta classe).
  async create(tenantId: string, input: CreatePriceListInput): Promise<PriceList> {
    this.assertName(input.name);
    this.assertAdjustmentPct(input.adjustmentPct);
    return this.priceLists.create({ tenantId, name: input.name.trim(), adjustmentPct: input.adjustmentPct });
  }

  findAll(tenantId: string): Promise<PriceList[]> {
    return this.priceLists.findAllActive(tenantId);
  }

  async findOne(tenantId: string, id: string): Promise<PriceList> {
    return this.requireList(tenantId, id);
  }

  async update(tenantId: string, id: string, input: UpdatePriceListInput): Promise<PriceList> {
    await this.requireList(tenantId, id);
    if (input.name !== undefined) this.assertName(input.name);
    if (input.adjustmentPct !== undefined) this.assertAdjustmentPct(input.adjustmentPct);

    return this.priceLists.update(id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.adjustmentPct !== undefined ? { adjustmentPct: input.adjustmentPct } : {}),
    });
  }

  async deactivate(tenantId: string, id: string): Promise<PriceList> {
    await this.requireList(tenantId, id);
    return this.priceLists.deactivate(id);
  }

  // Cria ou atualiza a exceção deste produto NESTA lista — idempotente por
  // (priceListId, productId), nunca duas linhas para o mesmo par (ver
  // @@unique no schema). "Set", não "create": reenviar o mesmo produto com
  // um valor novo apenas atualiza o override, não gera duplicidade.
  async setException(tenantId: string, priceListId: string, input: SetExceptionInput): Promise<PriceListException> {
    await this.requireList(tenantId, priceListId);
    if (!isValidOverridePrice(input.overridePrice)) {
      throw new BadRequestException('overridePrice deve ser um número positivo.');
    }
    const product = await this.products.findById(tenantId, input.productId);
    if (!product) {
      throw new BadRequestException(`Produto ${input.productId} não encontrado para este tenant.`);
    }

    return this.exceptions.upsert({
      tenantId,
      priceListId,
      productId: input.productId,
      overridePrice: input.overridePrice,
    });
  }

  async listExceptions(tenantId: string, priceListId: string): Promise<PriceListException[]> {
    await this.requireList(tenantId, priceListId);
    return this.exceptions.findAllByList(tenantId, priceListId);
  }

  async removeException(tenantId: string, priceListId: string, productId: string): Promise<void> {
    await this.requireList(tenantId, priceListId);
    const existing = await this.exceptions.findOne(tenantId, priceListId, productId);
    if (!existing) {
      throw new NotFoundException(`Não há exceção para o produto ${productId} nesta lista.`);
    }
    await this.exceptions.remove(existing.id);
  }

  // O ponto de leitura combinado: busca a lista + a exceção (se houver) do
  // produto informado, e delega o cálculo para a função pura resolveListPrice.
  // basePrice é responsabilidade de quem chama — ver comentário da classe.
  async resolvePrice(tenantId: string, priceListId: string, productId: string, basePrice: number): Promise<number> {
    const list = await this.requireList(tenantId, priceListId);
    const exception = await this.exceptions.findOne(tenantId, priceListId, productId);
    return resolveListPrice(basePrice, list.adjustmentPct, exception?.overridePrice);
  }

  private async requireList(tenantId: string, id: string): Promise<PriceList> {
    const list = await this.priceLists.findById(tenantId, id);
    if (!list) throw new NotFoundException(`Lista de preços ${id} não encontrada.`);
    return list;
  }

  private assertName(name: string): void {
    if (!isValidName(name)) {
      throw new BadRequestException('name deve ser um texto não vazio de até 100 caracteres.');
    }
  }

  private assertAdjustmentPct(pct: number): void {
    if (!isValidAdjustmentPct(pct)) {
      throw new BadRequestException('adjustmentPct deve estar entre -100 (exclusive) e 1000.');
    }
  }
}
