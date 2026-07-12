export interface Marketplace {
  id: string;
  code: string;
  displayName: string;
  isActive: boolean;
}

export interface MarketplaceRepository {
  findByCode(code: string): Promise<Marketplace | null>;
  findAllActive(): Promise<Marketplace[]>;
}

export const MARKETPLACE_REPOSITORY = Symbol('MARKETPLACE_REPOSITORY');
