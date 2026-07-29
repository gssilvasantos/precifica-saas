import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PRODUCT_WAREHOUSE_LOCATION_REPOSITORY,
  ProductWarehouseLocationRepository,
} from './ports/product-warehouse-location-repository.port';
import { WAREHOUSE_REPOSITORY, WarehouseRepository } from './ports/warehouse-repository.port';
import { isValidLocation, ProductWarehouseLocation } from '../domain/product-warehouse-location.entity';

// Benchmark Tiny ERP (28/07/2026, docs/tiny-erp-benchmark-analysis.md, seção
// 1.6) — mesmo padrão defensivo de WarehouseService.updateLeadTimeDays:
// valida ownership do depósito (via WAREHOUSE_REPOSITORY) antes de gravar,
// nunca confia só no warehouseId recebido do cliente.
@Injectable()
export class ProductWarehouseLocationService {
  constructor(
    @Inject(PRODUCT_WAREHOUSE_LOCATION_REPOSITORY) private readonly locations: ProductWarehouseLocationRepository,
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepository,
  ) {}

  async setLocation(tenantId: string, warehouseId: string, skuCode: string, location: string): Promise<ProductWarehouseLocation> {
    if (!isValidLocation(location)) {
      throw new BadRequestException('location deve ser um texto não vazio de até 100 caracteres.');
    }
    await this.assertWarehouseBelongsToTenant(tenantId, warehouseId);
    return this.locations.upsert({ tenantId, warehouseId, skuCode, location: location.trim() });
  }

  async listByWarehouse(tenantId: string, warehouseId: string): Promise<ProductWarehouseLocation[]> {
    await this.assertWarehouseBelongsToTenant(tenantId, warehouseId);
    return this.locations.findByWarehouse(tenantId, warehouseId);
  }

  private async assertWarehouseBelongsToTenant(tenantId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException(`Depósito ${warehouseId} não encontrado.`);
    }
  }
}
