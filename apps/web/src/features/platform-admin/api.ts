import { apiClient } from '../../lib/api-client';

// Espelha apps/api/src/modules/identity-access/application/platform-admin.service.ts
// (PlatformAdminTenantView/PlatformAdminUserView) — tela cross-tenant, só
// acessível a quem tem User.isPlatformAdmin=true (checado no backend a cada
// chamada pelo PlatformAdminGuard; aqui é só cosmético/roteamento).
export interface PlatformAdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  isPlatformAdmin: boolean;
}

export interface PlatformAdminTenant {
  id: string;
  name: string;
  document: string | null;
  isActive: boolean;
  createdAt: string;
  productCount: number;
  users: PlatformAdminUser[];
}

export async function fetchPlatformAdminTenants(): Promise<PlatformAdminTenant[]> {
  const { data } = await apiClient.get<PlatformAdminTenant[]>('/platform-admin/tenants');
  return data;
}

export async function blockTenant(tenantId: string): Promise<void> {
  await apiClient.patch(`/platform-admin/tenants/${tenantId}/block`);
}

export async function unblockTenant(tenantId: string): Promise<void> {
  await apiClient.patch(`/platform-admin/tenants/${tenantId}/unblock`);
}

export async function deleteTenant(tenantId: string): Promise<void> {
  await apiClient.delete(`/platform-admin/tenants/${tenantId}`);
}

export async function blockUser(userId: string): Promise<void> {
  await apiClient.patch(`/platform-admin/users/${userId}/block`);
}

export async function unblockUser(userId: string): Promise<void> {
  await apiClient.patch(`/platform-admin/users/${userId}/unblock`);
}
