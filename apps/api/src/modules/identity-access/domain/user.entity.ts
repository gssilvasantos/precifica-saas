import { UserRole } from '@prisma/client';

export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  isPlatformAdmin: boolean;
  moduleAccess: string[];
  createdAt: Date;
  updatedAt: Date;
}
