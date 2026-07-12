import { Warehouse, WarehouseUpsertData } from '../../domain/warehouse.entity';

export interface WarehouseRepository {
  findById(id: string): Promise<Warehouse | null>;
  findByCode(tenantId: string, code: string): Promise<Warehouse | null>;
  findAllByTenant(tenantId: string): Promise<Warehouse[]>;
  // Idempotente por (tenantId, code) — usado pelo WarehouseService para
  // garantir o depósito físico e cada CD Full sem duplicar em chamadas repetidas.
  upsert(data: WarehouseUpsertData): Promise<Warehouse>;
  // Edição do lead time (Sprint 25) — nunca passa pelo upsert (que só cria/
  // garante existência): é uma ação explícita do usuário, isolada, para não
  // arriscar sobrescrever outro campo por engano num upsert genérico.
  updateLeadTimeDays(tenantId: string, warehouseId: string, leadTimeDays: number): Promise<Warehouse>;
  // Sprint 26 — mesmo racional isolado de updateLeadTimeDays: nunca passa
  // pelo upsert genérico.
  updateLogisticsCostPerUnit(tenantId: string, warehouseId: string, logisticsCostPerUnit: number): Promise<Warehouse>;
}

export const WAREHOUSE_REPOSITORY = Symbol('WAREHOUSE_REPOSITORY');
