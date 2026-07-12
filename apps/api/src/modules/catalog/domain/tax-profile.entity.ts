import { TaxRegime } from '@prisma/client';

export interface TaxProfile {
  id: string;
  tenantId: string;
  name: string;
  regime: TaxRegime;
  estimatedRatePct: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
