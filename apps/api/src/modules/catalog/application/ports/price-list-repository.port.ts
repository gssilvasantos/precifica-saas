import { PriceList, PriceListCreateData, PriceListUpdateData } from '../../domain/price-list.entity';

export interface PriceListRepository {
  create(data: PriceListCreateData): Promise<PriceList>;
  findAllActive(tenantId: string): Promise<PriceList[]>;
  findById(tenantId: string, id: string): Promise<PriceList | null>;
  update(id: string, data: PriceListUpdateData): Promise<PriceList>;
  deactivate(id: string): Promise<PriceList>;
}

export const PRICE_LIST_REPOSITORY = Symbol('PRICE_LIST_REPOSITORY');
