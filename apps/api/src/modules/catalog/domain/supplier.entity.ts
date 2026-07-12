export interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  contact: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
