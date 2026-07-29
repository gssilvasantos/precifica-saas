export interface ProductStructureComponent {
  id: string;
  tenantId: string;
  parentSkuCode: string;
  componentSkuCode: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductStructureComponentUpsertData {
  componentSkuCode: string;
  quantity: number;
}

export interface ProductStructureRepository {
  findByParentSku(tenantId: string, parentSkuCode: string): Promise<ProductStructureComponent[]>;
  // Substitui a estrutura inteira do produto pai — semântica de PUT
  // idempotente (mesma disciplina de PriceListService/exceções): apaga tudo
  // e recria, nunca faz merge parcial. Simples e previsível para o caso de
  // uso real (editar a grade de componentes de um kit).
  replaceAll(
    tenantId: string,
    parentSkuCode: string,
    components: ProductStructureComponentUpsertData[],
  ): Promise<ProductStructureComponent[]>;
}

export const PRODUCT_STRUCTURE_REPOSITORY = Symbol('PRODUCT_STRUCTURE_REPOSITORY');
