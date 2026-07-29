import { PriceListException, PriceListExceptionCreateData } from '../../domain/price-list.entity';

export interface PriceListExceptionRepository {
  // Idempotente por (priceListId, productId) — chamador decide se
  // cria/atualiza (ver PriceListService.setException), mesmo racional de
  // upsert em outras portas desta base (WarehouseRepository.upsert).
  upsert(data: PriceListExceptionCreateData): Promise<PriceListException>;
  findAllByList(tenantId: string, priceListId: string): Promise<PriceListException[]>;
  findOne(tenantId: string, priceListId: string, productId: string): Promise<PriceListException | null>;
  remove(id: string): Promise<void>;
}

export const PRICE_LIST_EXCEPTION_REPOSITORY = Symbol('PRICE_LIST_EXCEPTION_REPOSITORY');
