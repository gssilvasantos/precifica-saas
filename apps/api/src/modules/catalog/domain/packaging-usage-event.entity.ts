// Entidade do log de consumo de embalagem — ver comentário completo em
// prisma/schema.prisma acima de `model PackagingUsageEvent`. Append-only:
// não existe UpdateData/deactivate aqui, só create + leitura.
export interface PackagingUsageEvent {
  id: string;
  tenantId: string;
  productId: string;
  packagingId: string;
  quantity: number;
  unitCostPrice: number;
  occurredAt: Date;
}

export interface PackagingUsageEventCreateData {
  tenantId: string;
  productId: string;
  packagingId: string;
  quantity: number;
  unitCostPrice: number;
}
