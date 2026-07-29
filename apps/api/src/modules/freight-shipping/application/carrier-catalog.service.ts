import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CARRIER_REPOSITORY, CarrierRecord, CarrierRepository } from './ports/carrier-repository.port';
import {
  CARRIER_SERVICE_REPOSITORY,
  CarrierServiceRecord,
  CarrierServiceRepository,
} from './ports/carrier-service-repository.port';
import {
  CarrierServiceMatch,
  isValidAutomationCode,
  matchCarrierServiceByFormaEnvio,
  resolveFormaEnvioForService,
} from '../domain/carrier-catalog';

export interface CreateCarrierInput {
  name: string;
}

export type UpdateCarrierInput = Partial<CreateCarrierInput>;

export interface CreateCarrierServiceInput {
  name: string;
  aliases?: string[];
  estimativaEntregaDias?: number | null;
  automationCode?: string | null;
}

export type UpdateCarrierServiceInput = Partial<CreateCarrierServiceInput>;

export interface CarrierServiceMatchResult extends CarrierServiceMatch {
  carrierName: string;
  serviceName: string;
  estimativaEntregaDias: number | null;
}

// Catálogo de Transportador/Serviço (Projeto Estruturante 5, benchmark Bling
// ERP, 29/07/2026 — ver docs/carrier-catalog-architecture.md). CRUD de
// cadastro puramente ADITIVO: DispatchBatch.formaEnvio continua uma string
// livre e nenhum gate existente do módulo logistics-fulfillment é alterado —
// este serviço só ajuda a RESOLVER qual string usar, e a enriquecer um
// formaEnvio já gravado com o transportador/serviço correspondente.
//
// Nunca faz DELETE físico (só setActive, mesmo racional de VendedorService e
// NaturezaOperacaoService): um Carrier/CarrierService já referenciado em
// lotes/pedidos passados não pode desaparecer silenciosamente.
@Injectable()
export class CarrierCatalogService {
  constructor(
    @Inject(CARRIER_REPOSITORY) private readonly carriers: CarrierRepository,
    @Inject(CARRIER_SERVICE_REPOSITORY) private readonly services: CarrierServiceRepository,
  ) {}

  // ---------------------------------------------------------------------
  // Carrier
  // ---------------------------------------------------------------------

  async createCarrier(tenantId: string, input: CreateCarrierInput): Promise<CarrierRecord> {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('name é obrigatório.');
    }

    const existing = await this.carriers.findByName(tenantId, name);
    if (existing) {
      throw new BadRequestException(`Já existe um transportador chamado "${name}" neste tenant.`);
    }

    return this.carriers.create({ tenantId, name, isActive: true });
  }

  async findAllCarriers(tenantId: string): Promise<CarrierRecord[]> {
    return this.carriers.findAllByTenant(tenantId);
  }

  async findCarrier(tenantId: string, id: string): Promise<CarrierRecord> {
    const record = await this.carriers.findById(tenantId, id);
    if (!record) {
      throw new NotFoundException(`Transportador ${id} não encontrado.`);
    }
    return record;
  }

  async updateCarrier(tenantId: string, id: string, input: UpdateCarrierInput): Promise<CarrierRecord> {
    const current = await this.findCarrier(tenantId, id);

    const name = input.name?.trim() ?? current.name;
    if (!name) {
      throw new BadRequestException('name é obrigatório.');
    }
    if (name !== current.name) {
      const existing = await this.carriers.findByName(tenantId, name);
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Já existe um transportador chamado "${name}" neste tenant.`);
      }
    }

    return this.carriers.update(id, { name });
  }

  async setCarrierActive(tenantId: string, id: string, isActive: boolean): Promise<CarrierRecord> {
    await this.findCarrier(tenantId, id);
    return this.carriers.update(id, { isActive });
  }

  // ---------------------------------------------------------------------
  // CarrierService (nested sob um Carrier)
  // ---------------------------------------------------------------------

  async createService(tenantId: string, carrierId: string, input: CreateCarrierServiceInput): Promise<CarrierServiceRecord> {
    await this.findCarrier(tenantId, carrierId);

    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('name é obrigatório.');
    }

    const automationCode = input.automationCode?.trim() || null;
    if (!isValidAutomationCode(automationCode)) {
      throw new BadRequestException(
        `automationCode "${automationCode}" não corresponde a nenhuma forma de envio conhecida — deixe em branco se este serviço não tiver automação de etiqueta.`,
      );
    }

    const existing = await this.services.findByNameForCarrier(carrierId, name);
    if (existing) {
      throw new BadRequestException(`Já existe um serviço chamado "${name}" para este transportador.`);
    }

    return this.services.create({
      tenantId,
      carrierId,
      name,
      aliases: input.aliases ?? [],
      estimativaEntregaDias: input.estimativaEntregaDias ?? null,
      automationCode,
      isActive: true,
    });
  }

  async findServicesByCarrier(tenantId: string, carrierId: string): Promise<CarrierServiceRecord[]> {
    await this.findCarrier(tenantId, carrierId);
    return this.services.findAllByCarrier(tenantId, carrierId);
  }

  async findService(tenantId: string, id: string): Promise<CarrierServiceRecord> {
    const record = await this.services.findById(tenantId, id);
    if (!record) {
      throw new NotFoundException(`Serviço de transportador ${id} não encontrado.`);
    }
    return record;
  }

  async updateService(tenantId: string, id: string, input: UpdateCarrierServiceInput): Promise<CarrierServiceRecord> {
    const current = await this.findService(tenantId, id);

    const name = input.name?.trim() ?? current.name;
    if (!name) {
      throw new BadRequestException('name é obrigatório.');
    }
    if (name !== current.name) {
      const existing = await this.services.findByNameForCarrier(current.carrierId, name);
      if (existing && existing.id !== id) {
        throw new BadRequestException(`Já existe um serviço chamado "${name}" para este transportador.`);
      }
    }

    const automationCode = input.automationCode !== undefined ? (input.automationCode?.trim() || null) : current.automationCode;
    if (!isValidAutomationCode(automationCode)) {
      throw new BadRequestException(
        `automationCode "${automationCode}" não corresponde a nenhuma forma de envio conhecida — deixe em branco se este serviço não tiver automação de etiqueta.`,
      );
    }

    return this.services.update(id, {
      name,
      aliases: input.aliases ?? current.aliases,
      estimativaEntregaDias: input.estimativaEntregaDias !== undefined ? input.estimativaEntregaDias : current.estimativaEntregaDias,
      automationCode,
    });
  }

  async setServiceActive(tenantId: string, id: string, isActive: boolean): Promise<CarrierServiceRecord> {
    await this.findService(tenantId, id);
    return this.services.update(id, { isActive });
  }

  // ---------------------------------------------------------------------
  // Resolução / matching (consumido pela integração aditiva com DispatchBatch)
  // ---------------------------------------------------------------------

  // Resolve um formaEnvio já gravado (texto livre) para o CarrierService
  // cadastrado correspondente, se existir — usado para ENRIQUECER um lote já
  // criado (nome do transportador, estimativa de entrega), nunca para
  // bloquear a criação do lote. Retorna null sem lançar se nada bater.
  async matchByFormaEnvio(tenantId: string, formaEnvio: string): Promise<CarrierServiceMatchResult | null> {
    const services = await this.services.findAllByTenant(tenantId);
    const match = matchCarrierServiceByFormaEnvio(formaEnvio, services);
    if (!match) {
      return null;
    }

    const service = services.find((s) => s.id === match.carrierServiceId);
    const carrier = await this.carriers.findById(tenantId, match.carrierId);
    return {
      ...match,
      carrierName: carrier?.name ?? '',
      serviceName: service?.name ?? match.matchedValue,
      estimativaEntregaDias: service?.estimativaEntregaDias ?? null,
    };
  }

  // Resolve a string a gravar em DispatchBatch.formaEnvio a partir de um
  // carrierServiceId cadastrado (fluxo inverso do match acima) — usado na
  // CRIAÇÃO do lote quando o operador escolhe um serviço do catálogo em vez
  // de digitar a forma de envio livremente. Exige serviço ATIVO.
  async resolveFormaEnvioForCarrierService(tenantId: string, carrierServiceId: string): Promise<string> {
    const service = await this.findService(tenantId, carrierServiceId);
    if (!service.isActive) {
      throw new BadRequestException(`Serviço "${service.name}" está inativo — ative-o antes de usá-lo num lote.`);
    }
    return resolveFormaEnvioForService(service);
  }
}
