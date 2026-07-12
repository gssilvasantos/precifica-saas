import { TaxRegime } from '@prisma/client';
import { TaxProfile } from '../../domain/tax-profile.entity';

export interface TaxProfileCreateData {
  tenantId: string;
  name: string;
  regime: TaxRegime;
  estimatedRatePct: number;
  notes?: string;
}

export type TaxProfileUpdateData = Partial<Omit<TaxProfileCreateData, 'tenantId'>>;

export interface TaxProfileRepository {
  create(data: TaxProfileCreateData): Promise<TaxProfile>;
  findAll(tenantId: string): Promise<TaxProfile[]>;
  findById(tenantId: string, id: string): Promise<TaxProfile | null>;
  update(id: string, data: TaxProfileUpdateData): Promise<TaxProfile>;
  remove(id: string): Promise<void>;
}

export const TAX_PROFILE_REPOSITORY = Symbol('TAX_PROFILE_REPOSITORY');
