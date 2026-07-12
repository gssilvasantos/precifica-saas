export interface Tenant {
  id: string;
  name: string;
  document: string | null;
  createdAt: Date;
  updatedAt: Date;
}
