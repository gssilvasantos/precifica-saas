export interface Tenant {
  id: string;
  name: string;
  document: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
