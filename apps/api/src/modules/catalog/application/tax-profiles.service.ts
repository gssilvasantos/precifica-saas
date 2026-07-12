import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TaxRegime } from '@prisma/client';
import {
  TAX_PROFILE_REPOSITORY,
  TaxProfileRepository,
  TaxProfileUpdateData,
} from './ports/tax-profile-repository.port';

export interface CreateTaxProfileInput {
  name: string;
  regime: TaxRegime;
  estimatedRatePct: number;
  notes?: string;
}

@Injectable()
export class TaxProfilesService {
  constructor(@Inject(TAX_PROFILE_REPOSITORY) private readonly taxProfiles: TaxProfileRepository) {}

  create(tenantId: string, input: CreateTaxProfileInput) {
    return this.taxProfiles.create({ tenantId, ...input });
  }

  findAll(tenantId: string) {
    return this.taxProfiles.findAll(tenantId);
  }

  async findOne(tenantId: string, id: string) {
    const profile = await this.taxProfiles.findById(tenantId, id);
    if (!profile) throw new NotFoundException('Perfil fiscal não encontrado.');
    return profile;
  }

  async update(tenantId: string, id: string, input: TaxProfileUpdateData) {
    await this.findOne(tenantId, id);
    return this.taxProfiles.update(id, input);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.taxProfiles.remove(id);
  }
}
