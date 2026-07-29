// Mapeamento categoria interna <-> categoria do canal (Fase 4, benchmark
// Tiny ERP) — espelha o model Prisma ChannelCategoryMapping. Chave de
// idempotência (tenantId, categoryId, marketplaceCode): uma categoria
// interna tem NO MÁXIMO um mapeamento por canal, por isso `upsert` (nunca
// create simples) — reconfigurar o mapeamento de uma categoria substitui o
// anterior, nunca acumula duplicatas.
export interface ChannelCategoryMapping {
  id: string;
  tenantId: string;
  categoryId: string;
  marketplaceCode: string;
  externalCategoryId: string;
  externalCategoryName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelCategoryMappingUpsertData {
  tenantId: string;
  categoryId: string;
  marketplaceCode: string;
  externalCategoryId: string;
  externalCategoryName: string;
}

export interface ChannelCategoryMappingRepository {
  upsert(data: ChannelCategoryMappingUpsertData): Promise<ChannelCategoryMapping>;
  findOne(tenantId: string, categoryId: string, marketplaceCode: string): Promise<ChannelCategoryMapping | null>;
  findAllByCategory(tenantId: string, categoryId: string): Promise<ChannelCategoryMapping[]>;
  remove(tenantId: string, id: string): Promise<void>;
}

export const CHANNEL_CATEGORY_MAPPING_REPOSITORY = Symbol('CHANNEL_CATEGORY_MAPPING_REPOSITORY');
