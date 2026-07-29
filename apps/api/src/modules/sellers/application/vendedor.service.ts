import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { VENDEDOR_REPOSITORY, VendedorRepository } from './ports/vendedor-repository.port';
import { SellerReader, SellerSummary } from '../../../shared/contracts/seller-reader.port';
import { isValidVendedorData, Vendedor, VendedorCreateData, VendedorUpdateData } from '../domain/vendedor.entity';

export interface CreateVendedorInput {
  name: string;
  email?: string | null;
  aliquotaComissaoPct: number;
  descontoMaximoPct?: number | null;
}

// CRUD de Vendedor (Projeto Estruturante 3, benchmark Bling ERP,
// 29/07/2026) — implementa SellerReader (shared/contracts), exposto ao
// Orders (CommissionService) via useExisting no módulo, mesmo racional de
// ProductStructureService/ProductLotService (Catalog) implementando as
// respectivas portas de leitura consumidas por outros módulos.
@Injectable()
export class VendedorService implements SellerReader {
  constructor(@Inject(VENDEDOR_REPOSITORY) private readonly vendedores: VendedorRepository) {}

  async create(tenantId: string, input: CreateVendedorInput): Promise<Vendedor> {
    const check = isValidVendedorData(input);
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    const data: VendedorCreateData = {
      tenantId,
      name: input.name,
      email: input.email ?? null,
      aliquotaComissaoPct: input.aliquotaComissaoPct,
      descontoMaximoPct: input.descontoMaximoPct ?? null,
    };
    return this.vendedores.create(data);
  }

  async findOne(tenantId: string, id: string): Promise<Vendedor> {
    return this.requireVendedor(tenantId, id);
  }

  list(tenantId: string): Promise<Vendedor[]> {
    return this.vendedores.findAllByTenant(tenantId);
  }

  async update(tenantId: string, id: string, data: VendedorUpdateData): Promise<Vendedor> {
    const current = await this.requireVendedor(tenantId, id);
    const check = isValidVendedorData({
      name: data.name ?? current.name,
      aliquotaComissaoPct: data.aliquotaComissaoPct ?? current.aliquotaComissaoPct,
      descontoMaximoPct: data.descontoMaximoPct !== undefined ? data.descontoMaximoPct : current.descontoMaximoPct,
    });
    if (!check.ok) {
      throw new BadRequestException(check.reason);
    }
    return this.vendedores.update(id, data);
  }

  async setActive(tenantId: string, id: string, isActive: boolean): Promise<Vendedor> {
    await this.requireVendedor(tenantId, id);
    return this.vendedores.setActive(id, isActive);
  }

  // Implementação de SellerReader — consumida pelo Orders
  // (CommissionService.assignVendedor). DTO autocontido, nunca o tipo
  // Vendedor completo.
  async findById(tenantId: string, vendedorId: string): Promise<SellerSummary | null> {
    const vendedor = await this.vendedores.findById(tenantId, vendedorId);
    if (!vendedor) return null;
    return {
      id: vendedor.id,
      name: vendedor.name,
      aliquotaComissaoPct: vendedor.aliquotaComissaoPct,
      isActive: vendedor.isActive,
    };
  }

  private async requireVendedor(tenantId: string, id: string): Promise<Vendedor> {
    const vendedor = await this.vendedores.findById(tenantId, id);
    if (!vendedor) {
      throw new NotFoundException(`Vendedor ${id} não encontrado.`);
    }
    return vendedor;
  }
}
