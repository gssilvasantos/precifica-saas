import { Packaging, PackagingCreateData, PackagingUpdateData } from '../../domain/packaging.entity';

export interface PackagingRepository {
  create(data: PackagingCreateData): Promise<Packaging>;
  findAllActive(tenantId: string): Promise<Packaging[]>;
  findById(tenantId: string, id: string): Promise<Packaging | null>;
  update(id: string, data: PackagingUpdateData): Promise<Packaging>;
  deactivate(id: string): Promise<Packaging>;
  // Sprint 26 — hierarquia de custo logístico (ver PackagingCostReader,
  // shared/contracts/). Assume no máximo 1 linha ativa com
  // purpose=SAFETY_DEFAULT por tenant — validado na camada de aplicação
  // (PackagingsService), nunca como constraint de banco; se houver mais de
  // uma, retorna a primeira encontrada (não é o caminho feliz esperado).
  findSafetyDefault(tenantId: string): Promise<Packaging | null>;
  // Ordenadas por maxCapacityKg ascendente.
  findAllMaster(tenantId: string): Promise<Packaging[]>;
}

export const PACKAGING_REPOSITORY = Symbol('PACKAGING_REPOSITORY');
