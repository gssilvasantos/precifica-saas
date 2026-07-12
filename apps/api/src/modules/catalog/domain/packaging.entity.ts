// Hierarquia de resolução de custo logístico de embalagem (Sprint 26, ver
// docs/promotion-intelligence-architecture.md): STANDARD é o comportamento
// de sempre (embalagem individual de 1 SKU); GROUPING é a embalagem de um
// kit/combo (Product.isKit=true aponta pra cá via packagingId); MASTER é a
// caixa maior usada em agrupamento dinâmico de vários SKUs avulsos num
// mesmo despacho (ainda sem consumidor nesta sprint — ver
// LogisticsCostReader.getPackagingCostForOrder); SAFETY_DEFAULT é o
// fallback conservador quando nada mais resolve.
export type PackagingPurpose = 'STANDARD' | 'GROUPING' | 'MASTER' | 'SAFETY_DEFAULT';

export interface Packaging {
  id: string;
  tenantId: string;
  name: string;
  weightG: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  costPrice: number;
  stockQuantity: number;
  isActive: boolean;
  purpose: PackagingPurpose;
  // Só relevante quando purpose = MASTER — capacidade máxima, em Kg, que
  // esta embalagem aguenta. Nulo em qualquer outro purpose.
  maxCapacityKg: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackagingCreateData {
  tenantId: string;
  name: string;
  weightG: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  costPrice: number;
  stockQuantity?: number;
  purpose?: PackagingPurpose;
  maxCapacityKg?: number;
}

export type PackagingUpdateData = Partial<Omit<PackagingCreateData, 'tenantId'>>;
