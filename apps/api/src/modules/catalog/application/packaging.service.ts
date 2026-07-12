import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PACKAGING_REPOSITORY, PackagingRepository } from './ports/packaging-repository.port';
import { PackagingCreateData, PackagingUpdateData } from '../domain/packaging.entity';
import { PACKAGING_EVENTS } from '../domain/packaging-events';
import { PackagingCostReader, PackagingCostSummary } from '../../../shared/contracts/packaging-cost-reader.port';

// CRUD de referência, mesmo padrão de SuppliersService/TaxProfilesService —
// Packaging é dado de configuração (cadastro reutilizável entre produtos),
// sem lógica de domínio própria além de "pertence a este tenant" — com UMA
// exceção: update() emite PACKAGING_EVENTS.COST_CHANGED quando costPrice
// muda, para disparar a reprecificação reativa no Pricing Intelligence (ver
// PackagingCostChangeListener). O cálculo em si nunca depende deste evento
// (CatalogReaderService lê o custo fresco sempre) — é só para não esperar o
// próximo sinal de concorrência para os produtos com autoRepricingEnabled=true.
//
// Implementa também PackagingCostReader (Sprint 26) — a porta que o
// LogisticsCostReaderService (Logistics Fulfillment) consome para resolver
// a hierarquia de custo de embalagem. Mesma disciplina de CatalogReaderService
// implementar duas portas: reaproveita o mesmo PACKAGING_REPOSITORY, só
// expõe uma fatia diferente para um consumidor externo.
@Injectable()
export class PackagingsService implements PackagingCostReader {
  constructor(
    @Inject(PACKAGING_REPOSITORY) private readonly packagings: PackagingRepository,
    private readonly events: EventEmitter2,
  ) {}

  create(tenantId: string, input: Omit<PackagingCreateData, 'tenantId'>) {
    return this.packagings.create({ tenantId, ...input });
  }

  findAll(tenantId: string) {
    return this.packagings.findAllActive(tenantId);
  }

  async findOne(tenantId: string, id: string) {
    const packaging = await this.packagings.findById(tenantId, id);
    if (!packaging) throw new NotFoundException('Embalagem não encontrada.');
    return packaging;
  }

  async update(tenantId: string, id: string, input: PackagingUpdateData) {
    const current = await this.findOne(tenantId, id);
    const updated = await this.packagings.update(id, input);

    if (input.costPrice !== undefined && input.costPrice !== current.costPrice) {
      this.events.emit(PACKAGING_EVENTS.COST_CHANGED, {
        tenantId,
        packagingId: id,
        previousCostPrice: current.costPrice,
        newCostPrice: updated.costPrice,
      });
    }

    return updated;
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.packagings.deactivate(id);
  }

  // --- PackagingCostReader (Sprint 26) ---

  async findById(tenantId: string, packagingId: string): Promise<PackagingCostSummary | null> {
    const packaging = await this.packagings.findById(tenantId, packagingId);
    return packaging ? this.toCostSummary(packaging) : null;
  }

  async findSafetyDefault(tenantId: string): Promise<PackagingCostSummary | null> {
    const packaging = await this.packagings.findSafetyDefault(tenantId);
    return packaging ? this.toCostSummary(packaging) : null;
  }

  async findAllMaster(tenantId: string): Promise<PackagingCostSummary[]> {
    const packagings = await this.packagings.findAllMaster(tenantId);
    return packagings.map((p) => this.toCostSummary(p));
  }

  private toCostSummary(packaging: {
    id: string;
    costPrice: number;
    purpose: PackagingCostSummary['purpose'];
    maxCapacityKg: number | null;
  }): PackagingCostSummary {
    return {
      id: packaging.id,
      costPrice: packaging.costPrice,
      purpose: packaging.purpose,
      maxCapacityKg: packaging.maxCapacityKg,
    };
  }
}
