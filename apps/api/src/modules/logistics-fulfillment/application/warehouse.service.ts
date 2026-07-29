import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WAREHOUSE_REPOSITORY, WarehouseRepository } from './ports/warehouse-repository.port';
import { STOCK_LEDGER_REPOSITORY, StockLedgerRepository } from './ports/stock-ledger-repository.port';
import {
  STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY,
  StockMovementAuditEventRepository,
} from './ports/stock-movement-audit-event-repository.port';
import { isValidLeadTimeDays, isValidLogisticsCostPerUnit, Warehouse } from '../domain/warehouse.entity';
import { mergeStockBalances, StockBalanceLine } from '../domain/stock-balance';

// Nome fixo do depósito físico — um por tenant, sempre o mesmo código.
// Diferente dos CDs Full (um código por canal), o físico não varia.
const PHYSICAL_WAREHOUSE_CODE = 'FISICO';

@Injectable()
export class WarehouseService {
  constructor(
    @Inject(WAREHOUSE_REPOSITORY) private readonly warehouses: WarehouseRepository,
    @Inject(STOCK_LEDGER_REPOSITORY) private readonly ledger: StockLedgerRepository,
    @Inject(STOCK_MOVEMENT_AUDIT_EVENT_REPOSITORY) private readonly auditEvents: StockMovementAuditEventRepository,
  ) {}

  // Idempotente — chamado sempre que um evento precisa do depósito físico
  // do tenant, sem exigir um passo de "setup" manual antes.
  async ensurePhysicalWarehouse(tenantId: string): Promise<Warehouse> {
    const existing = await this.warehouses.findByCode(tenantId, PHYSICAL_WAREHOUSE_CODE);
    if (existing) return existing;
    return this.warehouses.upsert({ tenantId, code: PHYSICAL_WAREHOUSE_CODE, type: 'PHYSICAL' });
  }

  // Idempotente por canal — "habilitar o Full no Mercado Livre" é só
  // garantir que o CD virtual daquele canal existe, nunca uma migration.
  async ensureFullWarehouse(tenantId: string, channelCode: string): Promise<Warehouse> {
    const code = `CD_FULL_${channelCode}`;
    const existing = await this.warehouses.findByCode(tenantId, code);
    if (existing) return existing;
    return this.warehouses.upsert({ tenantId, code, type: 'VIRTUAL_FULL', channelCode });
  }

  listByTenant(tenantId: string): Promise<Warehouse[]> {
    return this.warehouses.findAllByTenant(tenantId);
  }

  // Quick Win 3 (benchmark Bling, docs/bling-erp-benchmark-analysis.md,
  // seção 2 — EstoquesSaldosDTO saldoFisico/saldoVirtual) — combina o saldo
  // físico (StockLedgerRepository, já existia) com a reserva de pedidos
  // aguardando conferência (StockMovementAuditEventRepository, novo) via
  // mergeStockBalances (domain puro). Valida ownership do tenant primeiro,
  // mesmo padrão defensivo de updateLeadTimeDays/updateLogisticsCostPerUnit.
  async listStockBalances(tenantId: string, warehouseId: string): Promise<StockBalanceLine[]> {
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException(`Depósito ${warehouseId} não encontrado.`);
    }
    const [physical, reserved] = await Promise.all([
      this.ledger.listBalancesByWarehouse(tenantId, warehouseId),
      this.auditEvents.listReservedByWarehouse(tenantId, warehouseId),
    ]);
    return mergeStockBalances(physical, reserved);
  }

  // Edição do lead time (Sprint 25) — pedido explícito do usuário para
  // controlar a agressividade da reposição sem depender de um deploy.
  // Valida tenant (nunca edita depósito de outro tenant) e o valor (inteiro
  // positivo, teto de 90 dias — ver isValidLeadTimeDays).
  async updateLeadTimeDays(tenantId: string, warehouseId: string, leadTimeDays: number): Promise<Warehouse> {
    if (!isValidLeadTimeDays(leadTimeDays)) {
      throw new BadRequestException('leadTimeDays deve ser um número inteiro positivo (máximo 90 dias).');
    }
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException(`Depósito ${warehouseId} não encontrado.`);
    }
    return this.warehouses.updateLeadTimeDays(tenantId, warehouseId, leadTimeDays);
  }

  // Configuração do custo operacional do depósito (Sprint 26) — consumido
  // por LogisticsCostReaderService para compor o custo logístico total do
  // Motor de Margem de Promoções. Mesmo padrão defensivo de
  // updateLeadTimeDays: valida valor e ownership do tenant antes de gravar.
  async updateLogisticsCostPerUnit(tenantId: string, warehouseId: string, logisticsCostPerUnit: number): Promise<Warehouse> {
    if (!isValidLogisticsCostPerUnit(logisticsCostPerUnit)) {
      throw new BadRequestException('logisticsCostPerUnit deve ser um número maior ou igual a zero.');
    }
    const warehouse = await this.warehouses.findById(warehouseId);
    if (!warehouse || warehouse.tenantId !== tenantId) {
      throw new NotFoundException(`Depósito ${warehouseId} não encontrado.`);
    }
    return this.warehouses.updateLogisticsCostPerUnit(tenantId, warehouseId, logisticsCostPerUnit);
  }
}
